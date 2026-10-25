import { eq, ne, and, sql, ilike, or, count, desc, inArray, isNull, sum } from 'drizzle-orm';
import { db } from '../db';
import {
  users,
  events,
  eventStaff,
  festDays,
  settings,
  tickets,
  registrations,
  teams,
  teamMembers,
  purchases,
  payments,
  checkInLogs,
  auditLogs,
  userRoleEnum,
} from '../db/schema';
import { AppError } from '../common/errors';
import { validateFormSchema } from './form.service';
import type { UserSelect } from '../types/express';

// ==========================================
// 1. USER MANAGEMENT
// ==========================================

export async function listUsers(query: {
  search?: string;
  role?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const conditions = [];

  if (query.role) {
    conditions.push(eq(users.role, query.role as any));
  }
  if (query.isActive !== undefined) {
    conditions.push(eq(users.isActive, query.isActive ? 1 : 0));
  }
  if (query.search && query.search.trim()) {
    const pattern = `%${query.search.trim()}%`;
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(users.id, pattern))!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRes] = await db.select({ total: count() }).from(users).where(whereClause);
  const total = Number(totalRes?.total || 0);

  const userList = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      role: users.role,
      isStudent: users.isStudent,
      institutionName: users.institutionName,
      institutionId: users.institutionId,
      studentFieldsLocked: users.studentFieldsLocked,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.createdAt))
    .limit(pageSize)
    .offset(offset);

  const userIds = userList.map((u) => u.id);
  const assignmentRows =
    userIds.length > 0
      ? await db
          .select({
            userId: eventStaff.userId,
            eventId: eventStaff.eventId,
            eventTitle: events.title,
            role: eventStaff.role,
          })
          .from(eventStaff)
          .innerJoin(events, eq(eventStaff.eventId, events.id))
          .where(and(inArray(eventStaff.userId, userIds), isNull(eventStaff.revokedAt)))
      : [];

  const usersWithAssignments = userList.map((u) => ({
    ...u,
    event_staff_assignments: assignmentRows
      .filter((a) => a.userId === u.id)
      .map((a) => ({
        event_id: a.eventId,
        event_title: a.eventTitle,
        role: a.role,
      })),
  }));

  return { users: usersWithAssignments, page, pageSize, total };
}

export async function updateUserAdmin(
  adminUser: UserSelect,
  targetUserId: string,
  input: {
    role?: 'PARTICIPANT' | 'VOLUNTEER' | 'EVENT_LEAD' | 'LEAD' | 'SUPER_ADMIN';
    isActive?: boolean;
    studentFieldsLocked?: boolean;
  }
) {
  const [target] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) throw AppError.notFound(`User '${targetUserId}' not found`);

  // Self-Demotion Invariant: Super Admin cannot demote their own role or deactivate themselves
  if (adminUser.id === targetUserId) {
    if (input.role && input.role !== 'SUPER_ADMIN') {
      throw AppError.forbidden('Self-demotion prohibited: Super Admins cannot demote their own role');
    }
    if (input.isActive === false) {
      throw AppError.forbidden('Self-deactivation prohibited: Super Admins cannot deactivate their own account');
    }
  }

  const updates: Partial<typeof users.$inferInsert> = {
    updatedAt: Date.now(),
  };

  if (input.role) updates.role = input.role;
  if (input.isActive !== undefined) updates.isActive = input.isActive ? 1 : 0;
  if (input.studentFieldsLocked !== undefined) updates.studentFieldsLocked = input.studentFieldsLocked ? 1 : 0;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, targetUserId))
    .returning();

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'USER_ROLE_UPDATED',
    targetType: 'USER',
    targetId: targetUserId,
    details: { updates },
    beforeState: { role: target.role, isActive: target.isActive },
    afterState: { role: updated.role, isActive: updated.isActive },
    createdAt: Date.now(),
  });

  return updated;
}

export async function getUserDetailsAdmin(targetUserId: string) {
  const trimmedId = targetUserId.trim();

  // Find user by id or email
  const [target] = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.id, trimmedId),
        ilike(users.email, trimmedId)
      )
    )
    .limit(1);

  if (!target) {
    throw AppError.notFound(`User '${targetUserId}' not found`);
  }

  // 1. Direct registrations
  const directRegistrations = await db
    .select({
      registrationId: registrations.id,
      status: registrations.status,
      seatCount: registrations.seatCount,
      registeredAt: registrations.createdAt,
      confirmedAt: registrations.confirmedAt,
      eventId: events.id,
      eventSlug: events.slug,
      eventTitle: events.title,
      category: events.category,
      format: events.format,
      venue: events.venue,
      festDay: events.festDay,
      isTeam: events.isTeam,
      teamId: registrations.teamId,
      teamName: teams.name,
    })
    .from(registrations)
    .innerJoin(events, eq(registrations.eventId, events.id))
    .leftJoin(teams, eq(registrations.teamId, teams.id))
    .where(
      and(
        eq(registrations.participantId, target.id),
        inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
      )
    );

  // 2. Team registrations where user is an accepted member of the team
  const teamRegistrations = await db
    .select({
      registrationId: registrations.id,
      status: registrations.status,
      seatCount: registrations.seatCount,
      registeredAt: registrations.createdAt,
      confirmedAt: registrations.confirmedAt,
      eventId: events.id,
      eventSlug: events.slug,
      eventTitle: events.title,
      category: events.category,
      format: events.format,
      venue: events.venue,
      festDay: events.festDay,
      isTeam: events.isTeam,
      teamId: teams.id,
      teamName: teams.name,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(registrations, eq(teams.id, registrations.teamId))
    .innerJoin(events, eq(registrations.eventId, events.id))
    .where(
      and(
        eq(teamMembers.userId, target.id),
        eq(teamMembers.status, 'ACCEPTED'),
        inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
      )
    );

  // Deduplicate registrations by registrationId
  const regMap = new Map<string, typeof directRegistrations[0]>();
  for (const reg of directRegistrations) {
    regMap.set(reg.registrationId, reg);
  }
  for (const reg of teamRegistrations) {
    if (!regMap.has(reg.registrationId)) {
      regMap.set(reg.registrationId, reg);
    }
  }

  // 3. User Tickets
  const userTickets = await db
    .select({
      id: tickets.id,
      publicId: tickets.publicId,
      eventId: tickets.eventId,
      status: tickets.status,
      tier: tickets.tier,
      eventCheckedInAt: tickets.eventCheckedInAt,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.beneficiaryId, target.id));

  const ticketByEvent = new Map<string, typeof userTickets[0]>();
  for (const t of userTickets) {
    if (t.eventId) {
      ticketByEvent.set(t.eventId, t);
    }
  }

  const participatingEvents = Array.from(regMap.values()).map((r) => {
    const t = ticketByEvent.get(r.eventId);
    return {
      registrationId: r.registrationId,
      registrationStatus: r.status,
      registeredAt: r.registeredAt,
      confirmedAt: r.confirmedAt,
      event: {
        id: r.eventId,
        slug: r.eventSlug,
        title: r.eventTitle,
        category: r.category,
        format: r.format,
        venue: r.venue,
        festDay: r.festDay,
        isTeam: Boolean(r.isTeam),
      },
      team: r.teamId ? { id: r.teamId, name: r.teamName } : null,
      ticket: t
        ? {
            id: t.id,
            publicId: t.publicId,
            status: t.status,
            tier: t.tier,
            checkedInAt: t.eventCheckedInAt,
          }
        : null,
    };
  });

  // 4. Teams the user is in
  const userTeams = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      eventId: teams.eventId,
      eventTitle: events.title,
      eventSlug: events.slug,
      teamStatus: teams.status,
      leaderId: teams.leaderId,
      membershipRole: teamMembers.role,
      membershipStatus: teamMembers.status,
      joinedAt: teamMembers.createdAt,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(events, eq(teams.eventId, events.id))
    .where(
      and(
        or(eq(teamMembers.userId, target.id), ilike(teamMembers.invitedEmail, target.email)),
        ne(teams.status, 'CANCELLED')
      )
    )
    .orderBy(desc(teamMembers.createdAt));

  const formattedTeams = userTeams.map((t) => ({
    id: t.teamId,
    name: t.teamName,
    eventId: t.eventId,
    eventTitle: t.eventTitle,
    eventSlug: t.eventSlug,
    isLeader: t.leaderId === target.id,
    role: t.membershipRole,
    status: t.membershipStatus,
    teamStatus: t.teamStatus,
    joinedAt: t.joinedAt,
  }));

  // 5. Staff assignments
  const staffRows = await db
    .select({
      eventId: eventStaff.eventId,
      eventTitle: events.title,
      eventSlug: events.slug,
      role: eventStaff.role,
      assignedAt: eventStaff.createdAt,
    })
    .from(eventStaff)
    .innerJoin(events, eq(eventStaff.eventId, events.id))
    .where(and(eq(eventStaff.userId, target.id), isNull(eventStaff.revokedAt)));

  return {
    id: target.id,
    name: target.name,
    email: target.email,
    phone: target.phone,
    avatarUrl: target.avatarUrl,
    role: target.role,
    isStudent: Boolean(target.isStudent),
    institutionName: target.institutionName,
    institutionId: target.institutionId,
    studentFieldsLocked: Boolean(target.studentFieldsLocked),
    isActive: Boolean(target.isActive),
    profileCompletedAt: target.profileCompletedAt,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    events: participatingEvents,
    teams: formattedTeams,
    staffAssignments: staffRows,
  };
}

// ==========================================
// 2. EVENT MANAGEMENT & SAFE DELETION
// ==========================================

export async function createEventAdmin(adminUser: UserSelect, input: any) {
  const slug = input.slug || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const now = Date.now();

  let validatedFormSchema = null;
  if (input.formSchema || input.form_schema) {
    validatedFormSchema = validateFormSchema(input.formSchema || input.form_schema);
  }

  const [newEvent] = await db
    .insert(events)
    .values({
      slug,
      title: input.title,
      imageUrl: input.imageURL ?? input.imageUrl ?? null,
      category: input.category,
      format: input.format || 'INDIVIDUAL',
      festDay: input.festDay || input.fest_day,
      shortDescription: input.shortDescription || input.short_description,
      description: input.description,
      rules: input.rules,
      venue: input.venue,
      organizer: input.organizer,
      eligibility: input.eligibility,
      timeline: input.timeline || [],
      prizes: input.prizes || [],
      metadata: input.metadata || {},
      priceModel: input.priceModel || input.price_model || 'FREE',
      pricePaise: input.pricePaise ?? input.price_paise ?? 0,
      studentPricePaise: input.studentPricePaise ?? input.student_price_paise ?? 0,
      isTeam: input.isTeam ?? input.is_team ? 1 : 0,
      minTeamSize: input.minTeamSize ?? input.min_team_size ?? 1,
      maxTeamSize: input.maxTeamSize ?? input.max_team_size ?? 1,
      capacity: input.capacity ?? null,
      capacityUnit: input.capacityUnit || input.capacity_unit || 'SEATS',
      status: input.status || 'DRAFT',
      scoringEnabled: input.category === 'E_SPORTS' ? 1 : 0,
      scoringStatus: input.category === 'E_SPORTS' ? 'OPEN' : 'NOT_APPLICABLE',
      leaderboardPublic: 0,
      volunteersCanScore: input.volunteersCanScore ? 1 : 0,
      formSchema: validatedFormSchema,
      registrationOpensAt: input.registrationOpensAt ?? input.registration_opens_at,
      registrationClosesAt: input.registrationClosesAt ?? input.registration_closes_at,
      startsAt: input.startsAt ?? input.starts_at,
      endsAt: input.endsAt ?? input.ends_at,
      createdBy: adminUser.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'EVENT_CREATED',
    targetType: 'EVENT',
    targetId: newEvent.id,
    details: { title: newEvent.title, slug: newEvent.slug },
    createdAt: now,
  });

  return newEvent;
}

export async function updateEventAdmin(adminUser: UserSelect, eventId: string, input: any) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw AppError.notFound(`Event '${eventId}' not found`);

  // Capacity Integrity: Cannot reduce capacity below current seats_taken
  const newCapacity = input.capacity !== undefined ? input.capacity : event.capacity;
  if (newCapacity !== null && newCapacity < event.seatsTaken) {
    throw AppError.badRequest(
      `Cannot reduce capacity to ${newCapacity}. Current seats taken is ${event.seatsTaken}.`,
      'CAPACITY_BELOW_OCCUPANCY'
    );
  }

  const updates: Record<string, any> = { updatedAt: Date.now() };

  const imageUrl = input.imageURL ?? input.imageUrl;
  if (imageUrl !== undefined) {
    updates.imageUrl = imageUrl;
  }

  if (input.title) updates.title = input.title;
  if (input.slug) updates.slug = input.slug;
  if (input.category) updates.category = input.category;
  if (input.format) updates.format = input.format;
  if (input.festDay !== undefined) updates.festDay = input.festDay;
  if (input.shortDescription !== undefined) updates.shortDescription = input.shortDescription;
  if (input.description !== undefined) updates.description = input.description;
  if (input.rules !== undefined) {
    if (Array.isArray(input.rules)) {
      updates.rules = input.rules.join('\n');
    } else if (typeof input.rules === 'string') {
      updates.rules = input.rules;
    } else {
      updates.rules = String(input.rules);
    }
  }
  if (input.venue !== undefined) updates.venue = input.venue;
  if (input.organizer !== undefined) updates.organizer = input.organizer;
  if (input.eligibility !== undefined) updates.eligibility = input.eligibility;
  if (input.timeline !== undefined) updates.timeline = input.timeline;
  if (input.prizes !== undefined) updates.prizes = input.prizes;
  if (input.metadata !== undefined) updates.metadata = input.metadata;
  if (input.priceModel) updates.priceModel = input.priceModel;
  if (input.pricePaise !== undefined) updates.pricePaise = input.pricePaise;
  if (input.studentPricePaise !== undefined) updates.studentPricePaise = input.studentPricePaise;
  if (input.isTeam !== undefined) updates.isTeam = input.isTeam ? 1 : 0;
  if (input.minTeamSize !== undefined) updates.minTeamSize = input.minTeamSize;
  if (input.maxTeamSize !== undefined) updates.maxTeamSize = input.maxTeamSize;
  if (input.capacity !== undefined) updates.capacity = input.capacity;
  if (input.capacityUnit) updates.capacityUnit = input.capacityUnit;
  if (input.status) updates.status = input.status;
  if (input.volunteersCanScore !== undefined) updates.volunteersCanScore = input.volunteersCanScore ? 1 : 0;
  if (input.registrationOpensAt !== undefined) updates.registrationOpensAt = input.registrationOpensAt;
  if (input.registrationClosesAt !== undefined) updates.registrationClosesAt = input.registrationClosesAt;
  if (input.startsAt !== undefined) updates.startsAt = input.startsAt;
  if (input.endsAt !== undefined) updates.endsAt = input.endsAt;

  if (input.formSchema || input.form_schema) {
    updates.formSchema = validateFormSchema(input.formSchema || input.form_schema);
  }

  const [updated] = await db.update(events).set(updates).where(eq(events.id, eventId)).returning();

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'EVENT_UPDATED',
    targetType: 'EVENT',
    targetId: eventId,
    details: { updates },
    createdAt: Date.now(),
  });

  return updated;
}

/**
 * Safe Deletion Invariant:
 * If an event has registrations or tickets, soft-delete to 'CANCELLED'.
 * If zero attendees, hard-delete cleanly.
 */
export async function safeDeleteEventAdmin(adminUser: UserSelect, eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw AppError.notFound(`Event '${eventId}' not found`);

  const [regCountRes] = await db
    .select({ total: count() })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));

  const attendeeCount = Number(regCountRes?.total || 0);

  if (attendeeCount > 0) {
    // Attendees exist: Soft-delete by setting status = 'CANCELLED'
    const [cancelled] = await db
      .update(events)
      .set({ status: 'CANCELLED', updatedAt: Date.now() })
      .where(eq(events.id, eventId))
      .returning();

    await db.insert(auditLogs).values({
      actorId: adminUser.id,
      action: 'EVENT_CANCELLED',
      targetType: 'EVENT',
      targetId: eventId,
      details: {
        reason: 'Event deleted by Super Admin with active registrations. Soft-cancelled to preserve order history.',
        attendeeCount,
      },
      createdAt: Date.now(),
    });

    return {
      deleted: false,
      status: 'CANCELLED',
      message: `Event '${event.title}' has ${attendeeCount} registrations. Status set to CANCELLED to preserve attendee records.`,
      event: cancelled,
    };
  }

  // Zero attendees: Hard-delete event_staff and event row
  await db.delete(eventStaff).where(eq(eventStaff.eventId, eventId));
  await db.delete(events).where(eq(events.id, eventId));

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'EVENT_DELETED',
    targetType: 'EVENT',
    targetId: eventId,
    details: { title: event.title, deletedCleanly: true },
    createdAt: Date.now(),
  });

  return {
    deleted: true,
    message: `Event '${event.title}' deleted cleanly.`,
  };
}

// ==========================================
// 3. STAFF ASSIGNMENT CONTROL
// ==========================================

export async function assignStaffAdmin(
  adminUser: UserSelect,
  eventId: string,
  targetUserId: string,
  role: 'EVENT_LEAD' | 'LEAD' | 'VOLUNTEER'
) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw AppError.notFound(`Event '${eventId}' not found`);

  const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!targetUser) throw AppError.notFound(`User '${targetUserId}' not found`);

  const now = Date.now();
  const normalizedRole = role === 'LEAD' ? 'EVENT_LEAD' : role;

  let reassignedFrom: { eventId: string; eventTitle: string } | null = null;

  // Single-Lead Invariant: One user can only lead one event at a time.
  // If user was already leading another event, automatically revoke the old lead assignment.
  if (normalizedRole === 'EVENT_LEAD') {
    const [existingLead] = await db
      .select({
        eventId: eventStaff.eventId,
        eventTitle: events.title,
      })
      .from(eventStaff)
      .innerJoin(events, eq(eventStaff.eventId, events.id))
      .where(
        and(
          eq(eventStaff.userId, targetUserId),
          inArray(eventStaff.role, ['EVENT_LEAD', 'LEAD']),
          isNull(eventStaff.revokedAt),
          ne(eventStaff.eventId, eventId)
        )
      )
      .limit(1);

    if (existingLead) {
      // Automatically revoke previous lead assignment
      await db
        .update(eventStaff)
        .set({ revokedAt: now })
        .where(
          and(
            eq(eventStaff.eventId, existingLead.eventId),
            eq(eventStaff.userId, targetUserId)
          )
        );

      await db.insert(auditLogs).values({
        actorId: adminUser.id,
        action: 'STAFF_LEAD_TRANSFERRED',
        targetType: 'EVENT_STAFF',
        targetId: `${existingLead.eventId}:${targetUserId}`,
        details: {
          previousEventId: existingLead.eventId,
          previousEventTitle: existingLead.eventTitle,
          newEventId: eventId,
          userId: targetUserId,
          reason: 'Auto-transferred to new event as Event Lead',
        },
        createdAt: now,
      });

      reassignedFrom = existingLead;
    }
  }

  const [assignment] = await db
    .insert(eventStaff)
    .values({
      eventId,
      userId: targetUserId,
      role: normalizedRole,
      assignedBy: adminUser.id,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [eventStaff.eventId, eventStaff.userId],
      set: {
        role: normalizedRole,
        revokedAt: null,
      },
    })
    .returning();

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'STAFF_ASSIGNED',
    targetType: 'EVENT_STAFF',
    targetId: `${eventId}:${targetUserId}`,
    details: { eventId, userId: targetUserId, role: normalizedRole },
    createdAt: now,
  });

  return {
    ...assignment,
    reassignedFrom,
  };
}

export async function removeStaffAdmin(adminUser: UserSelect, eventId: string, targetUserId: string) {
  await db
    .update(eventStaff)
    .set({ revokedAt: Date.now() })
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, targetUserId)));

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'STAFF_REMOVED',
    targetType: 'EVENT_STAFF',
    targetId: `${eventId}:${targetUserId}`,
    details: { eventId, userId: targetUserId },
    createdAt: Date.now(),
  });

  return { message: 'Staff assignment revoked successfully' };
}

// ==========================================
// 4. FESTIVAL SETTINGS & SCHEDULE SYNC
// ==========================================

export async function updateSettingAdmin(adminUser: UserSelect, key: string, value: any) {
  const now = Date.now();
  const [setting] = await db
    .insert(settings)
    .values({ key, value, updatedBy: adminUser.id, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: adminUser.id, updatedAt: now },
    })
    .returning();

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'SETTINGS_UPDATED',
    targetType: 'SETTING',
    targetId: key,
    details: { key, value },
    createdAt: now,
  });

  return setting;
}

/**
 * Automatic Sync Invariant:
 * When a festival day's validFrom or validTo is updated,
 * automatically synchronize all active tickets linked to that day's events.
 */
export async function updateFestDayAdmin(
  adminUser: UserSelect,
  dayNumber: number,
  input: { date?: string; validFrom?: number; validTo?: number; description?: string }
) {
  const [day] = await db.select().from(festDays).where(eq(festDays.dayNumber, dayNumber)).limit(1);
  if (!day) throw AppError.notFound(`Fest Day ${dayNumber} not found`);

  const updates: any = {};
  if (input.date) updates.date = input.date;
  if (input.validFrom !== undefined) updates.validFrom = input.validFrom;
  if (input.validTo !== undefined) updates.validTo = input.validTo;
  if (input.description !== undefined) updates.description = input.description;

  const [updatedDay] = await db
    .update(festDays)
    .set(updates)
    .where(eq(festDays.dayNumber, dayNumber))
    .returning();

  // Automatic Sync: Update validity on tickets for events on this day
  if (input.validFrom !== undefined || input.validTo !== undefined) {
    const dayEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.festDay, dayNumber));

    const dayEventIds = dayEvents.map((e) => e.id);

    if (dayEventIds.length > 0) {
      await db
        .update(tickets)
        .set({
          validFrom: input.validFrom ?? day.validFrom,
          validTo: input.validTo ?? day.validTo,
          updatedAt: Date.now(),
        })
        .where(and(inArray(tickets.eventId, dayEventIds), eq(tickets.status, 'ACTIVE')));
    }
  }

  await db.insert(auditLogs).values({
    actorId: adminUser.id,
    action: 'FEST_DAY_UPDATED',
    targetType: 'FEST_DAY',
    targetId: String(dayNumber),
    details: { updates },
    createdAt: Date.now(),
  });

  return updatedDay;
}

// ==========================================
// 5. BI & ANALYTICAL REPORTS
// ==========================================

export async function getSummaryReport() {
  // Gross Revenue in paise from APPROVED/SUCCESS payments
  const [revenueResult] = await db
    .select({
      totalRevenuePaise: sql<number>`coalesce(sum(${payments.amountPaise}), 0)`,
    })
    .from(payments)
    .where(inArray(payments.status, ['APPROVED', 'SUCCESS']));

  // Total Passes Sold (Gate vs Event)
  const [ticketStats] = await db
    .select({
      totalTickets: count(),
      gatePasses: sql<number>`count(*) filter (where ${tickets.itemType} = 'GATE_PASS')`,
      eventPasses: sql<number>`count(*) filter (where ${tickets.itemType} = 'EVENT_PASS')`,
      checkedInAttendees: sql<number>`count(*) filter (where ${tickets.eventCheckedInAt} is not null)`,
    })
    .from(tickets)
    .where(eq(tickets.status, 'ACTIVE'));

  // Capacity utilization across all events
  const [capacityStats] = await db
    .select({
      totalCapacity: sql<number>`coalesce(sum(${events.capacity}), 0)`,
      totalSeatsTaken: sql<number>`coalesce(sum(${events.seatsTaken}), 0)`,
    })
    .from(events);

  const totalCapacity = Number(capacityStats?.totalCapacity || 0);
  const totalSeatsTaken = Number(capacityStats?.totalSeatsTaken || 0);
  const capacityUtilizationPercent =
    totalCapacity > 0 ? Math.round((totalSeatsTaken / totalCapacity) * 100) : 0;

  const grossRevenuePaise = Number(revenueResult?.totalRevenuePaise || 0);

  return {
    grossRevenuePaise,
    grossRevenueInr: grossRevenuePaise / 100,
    passesSold: {
      total: Number(ticketStats?.totalTickets || 0),
      gatePasses: Number(ticketStats?.gatePasses || 0),
      eventPasses: Number(ticketStats?.eventPasses || 0),
    },
    verifiedAttendees: Number(ticketStats?.checkedInAttendees || 0),
    capacity: {
      totalCapacity,
      totalSeatsTaken,
      utilizationPercent: capacityUtilizationPercent,
    },
  };
}

export async function getFinancialReport() {
  const [revenueStats] = await db
    .select({
      totalRevenuePaise: sql<number>`coalesce(sum(${payments.amountPaise}), 0)`,
    })
    .from(payments)
    .where(inArray(payments.status, ['APPROVED', 'SUCCESS']));

  const [tierStats] = await db
    .select({
      studentPassesCount: sql<number>`count(*) filter (where ${tickets.tier} = 'STUDENT')`,
      generalPassesCount: sql<number>`count(*) filter (where ${tickets.tier} = 'GENERAL')`,
    })
    .from(tickets);

  const [paymentMethodStats] = await db
    .select({
      upiPaidOrders: sql<number>`count(*) filter (where ${purchases.paymentMethod} = 'UPI')`,
      freeOrders: sql<number>`count(*) filter (where ${purchases.paymentMethod} = 'FREE')`,
    })
    .from(purchases)
    .where(eq(purchases.status, 'PAID'));

  const totalRevenuePaise = Number(revenueStats?.totalRevenuePaise || 0);

  return {
    totalRevenuePaise,
    totalRevenueInr: totalRevenuePaise / 100,
    tierBreakdown: {
      studentPasses: Number(tierStats?.studentPassesCount || 0),
      generalPasses: Number(tierStats?.generalPassesCount || 0),
    },
    paymentMethods: {
      upiOrders: Number(paymentMethodStats?.upiPaidOrders || 0),
      freeOrders: Number(paymentMethodStats?.freeOrders || 0),
    },
  };
}

export async function getAttendanceReport() {
  // Gate turnstile count vs Event check-ins
  const [scanStats] = await db
    .select({
      gateCheckIns: sql<number>`count(*) filter (where ${checkInLogs.context} = 'GATE' and ${checkInLogs.verdict} = 'ADMITTED')`,
      eventCheckIns: sql<number>`count(*) filter (where ${checkInLogs.context} = 'EVENT' and ${checkInLogs.verdict} = 'ADMITTED')`,
      deniedScans: sql<number>`count(*) filter (where ${checkInLogs.verdict} = 'DENIED')`,
    })
    .from(checkInLogs);

  // Per-event attendance turnstile
  const eventAttendance = await db
    .select({
      eventId: events.id,
      eventTitle: events.title,     // keep only ONE of these
      festDay: events.festDay,
      seatsTaken: events.seatsTaken,
      capacity: events.capacity,
      checkedInCount: sql<number>`count(${tickets.id}) filter (where ${tickets.eventCheckedInAt} is not null)`,
    })
    .from(events)
    .leftJoin(tickets, eq(events.id, tickets.eventId))
    .groupBy(events.id, events.title, events.festDay, events.seatsTaken, events.capacity)
    .orderBy(desc(events.seatsTaken));

  return {
    turnstile: {
      gateCheckIns: Number(scanStats?.gateCheckIns || 0),
      eventCheckIns: Number(scanStats?.eventCheckIns || 0),
      deniedScans: Number(scanStats?.deniedScans || 0),
    },
    eventBreakdown: eventAttendance.map((e) => ({
      eventId: e.eventId,
      title: e.eventTitle,
      festDay: e.festDay,
      confirmedAttendees: e.seatsTaken,
      capacity: e.capacity,
      actualCheckedIn: Number(e.checkedInCount || 0),
      turnoutPercent: e.seatsTaken > 0 ? Math.round((Number(e.checkedInCount || 0) / e.seatsTaken) * 100) : 0,
    })),
  };
}

export async function listAuditLogs(query: {
  action?: string;
  actorId?: string;
  targetType?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.actorId) conditions.push(eq(auditLogs.actorId, query.actorId));
  if (query.targetType) conditions.push(eq(auditLogs.targetType, query.targetType));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRes] = await db.select({ total: count() }).from(auditLogs).where(whereClause);
  const total = Number(totalRes?.total || 0);

  const logs = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      actorId: auditLogs.actorId,
      actorName: users.name,
      details: auditLogs.details,
      beforeState: auditLogs.beforeState,
      afterState: auditLogs.afterState,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorId, users.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageSize)
    .offset(offset);

  return { logs, page, pageSize, total };
}

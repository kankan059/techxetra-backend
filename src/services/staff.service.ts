import { eq, and, sql, ilike, or, count, inArray, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  events,
  eventStaff,
  users,
  registrations,
  teams,
  teamMembers,
  tickets,
  purchaseItems,
  purchases,
  auditLogs,
} from '../db/schema';
import { AppError } from '../common/errors';
import { validateFormSchema } from './form.service';
import type { UserSelect } from '../types/express';

/**
 * Ensures caller is actively assigned to the given event (or is Super Admin).
 * Returns { event, assignment, isSuperAdmin, isLead }
 */
export async function verifyEventStaffAccess(staffUser: UserSelect, eventId: string) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw AppError.notFound(`Event '${eventId}' not found`);
  }

  const isSuperAdmin = staffUser.role === 'SUPER_ADMIN';

  if (isSuperAdmin) {
    return { event, assignment: null, isSuperAdmin: true, isLead: true };
  }

  const [assignment] = await db
    .select()
    .from(eventStaff)
    .where(
      and(
        eq(eventStaff.eventId, eventId),
        eq(eventStaff.userId, staffUser.id),
        sql`${eventStaff.revokedAt} IS NULL`
      )
    )
    .limit(1);

  if (!assignment) {
    throw AppError.forbidden(
      'Access Denied: You are not assigned as staff to this event.',
      'NOT_ASSIGNED_TO_EVENT'
    );
  }

  const isLead = assignment.role === 'EVENT_LEAD' || assignment.role === 'LEAD';

  return { event, assignment, isSuperAdmin: false, isLead };
}

/**
 * Lists all events assigned to the staff user (or all events for Super Admin).
 */
export async function getAssignedEvents(staffUser: UserSelect) {
  const isSuperAdmin = staffUser.role === 'SUPER_ADMIN';

  let eventList;
  if (isSuperAdmin) {
    eventList = await db.select().from(events).orderBy(desc(events.createdAt));
  } else {
    const assignedRows = await db
      .select({
        event: events,
        role: eventStaff.role,
      })
      .from(eventStaff)
      .innerJoin(events, eq(eventStaff.eventId, events.id))
      .where(and(eq(eventStaff.userId, staffUser.id), sql`${eventStaff.revokedAt} IS NULL`))
      .orderBy(desc(events.createdAt));

    eventList = assignedRows.map((r) => ({
      ...r.event,
      staffRole: r.role,
    }));
  }

  // Attach live metrics to each assigned event
  const enriched = [];
  for (const ev of eventList) {
    const [stats] = await db
      .select({
        confirmedCount: sql<number>`count(*) filter (where ${registrations.status} = 'CONFIRMED')`,
        reservedCount: sql<number>`count(*) filter (where ${registrations.status} = 'RESERVED')`,
      })
      .from(registrations)
      .where(eq(registrations.eventId, ev.id));

    const capacity = ev.capacity;
    const seatsRemaining = capacity !== null ? Math.max(0, capacity - ev.seatsTaken) : null;

    enriched.push({
      id: ev.id,
      slug: ev.slug,
      title: ev.title,
      category: ev.category,
      format: ev.format,
      venue: ev.venue,
      status: ev.status,
      capacity,
      seatsTaken: ev.seatsTaken,
      seatsRemaining,
      confirmedCount: Number(stats?.confirmedCount || 0),
      reservedCount: Number(stats?.reservedCount || 0),
      scoringStatus: ev.scoringStatus,
    });
  }

  return enriched;
}

/**
 * Event operational dashboard with live check-in counts and staff roster.
 */
export async function getEventDashboard(staffUser: UserSelect, eventId: string) {
  const { event } = await verifyEventStaffAccess(staffUser, eventId);

  // 1. Registrations count
  const [stats] = await db
    .select({
      totalRegistrations: count(),
      confirmedCount: sql<number>`count(*) filter (where ${registrations.status} = 'CONFIRMED')`,
      reservedCount: sql<number>`count(*) filter (where ${registrations.status} = 'RESERVED')`,
    })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));

  // 2. Total Checked-In Attendees
  const [checkedInStats] = await db
    .select({
      checkedInCount: sql<number>`count(*) filter (where ${tickets.eventCheckedInAt} is not null)`,
    })
    .from(tickets)
    .where(eq(tickets.eventId, eventId));

  // 3. Assigned staff roster
  const staffMembers = await db
    .select({
      userId: eventStaff.userId,
      role: eventStaff.role,
      assignedAt: eventStaff.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(eventStaff)
    .innerJoin(users, eq(eventStaff.userId, users.id))
    .where(and(eq(eventStaff.eventId, eventId), sql`${eventStaff.revokedAt} IS NULL`));

  const seatsRemaining =
    event.capacity !== null && event.capacity !== undefined
      ? Math.max(0, event.capacity - event.seatsTaken)
      : null;

  return {
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
      category: event.category,
      venue: event.venue,
      status: event.status,
      festDay: event.festDay,
      isTeam: Boolean(event.isTeam),
      minTeamSize: event.minTeamSize,
      maxTeamSize: event.maxTeamSize,
      capacity: event.capacity,
      capacityUnit: event.capacityUnit,
      seatsTaken: event.seatsTaken,
      seatsRemaining,
      scoringStatus: event.scoringStatus,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    },
    metrics: {
      totalRegistrations: Number(stats?.totalRegistrations || 0),
      confirmedCount: Number(stats?.confirmedCount || 0),
      reservedCount: Number(stats?.reservedCount || 0),
      checkedInCount: Number(checkedInStats?.checkedInCount || 0),
    },
    staffRoster: staffMembers,
  };
}

export interface GetRosterOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Returns privacy-tiered participant and team roster for an event.
 * Event Leads receive approved operational details; Volunteers receive minimal details.
 * Zero UTRs, payment evidence, or reviewer notes are ever exposed.
 */
export async function getEventAttendeeRoster(
  staffUser: UserSelect,
  eventId: string,
  options: GetRosterOptions = {}
) {
  const { isLead, isSuperAdmin } = await verifyEventStaffAccess(staffUser, eventId);
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(registrations.eventId, eventId),
    inArray(registrations.status, ['RESERVED', 'CONFIRMED']),
  ];

  if (options.search && options.search.trim()) {
    const pattern = `%${options.search.trim()}%`;
    conditions.push(
      or(
        ilike(users.name, pattern),
        ilike(users.email, pattern),
        ilike(teams.name, pattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  // Total count
  const [totalResult] = await db
    .select({ total: count() })
    .from(registrations)
    .innerJoin(users, eq(registrations.participantId, users.id))
    .leftJoin(teams, eq(registrations.teamId, teams.id))
    .where(whereClause);

  const total = Number(totalResult?.total || 0);

  // Query roster rows
  const rosterRows = await db
    .select({
      registration: registrations,
      participant: users,
      team: teams,
      ticket: tickets,
      purchase: {
        status: purchases.status,
      },
    })
    .from(registrations)
    .innerJoin(users, eq(registrations.participantId, users.id))
    .leftJoin(teams, eq(registrations.teamId, teams.id))
    .leftJoin(tickets, eq(registrations.id, tickets.registrationId))
    .leftJoin(purchaseItems, eq(registrations.purchaseItemId, purchaseItems.id))
    .leftJoin(purchases, eq(purchaseItems.purchaseId, purchases.id))
    .where(whereClause)
    .orderBy(desc(registrations.createdAt))
    .limit(pageSize)
    .offset(offset);

  // Privacy-tiered serialization
  const serialized = rosterRows.map((row) => {
    const base = {
      registrationId: row.registration.id,
      registrationStatus: row.registration.status,
      confirmedAt: row.registration.confirmedAt,
      seatCount: row.registration.seatCount,
      team: row.team
        ? {
            id: row.team.id,
            name: row.team.name,
            leaderId: row.team.leaderId,
          }
        : null,
      ticket: row.ticket
        ? {
            id: row.ticket.id,
            publicId: row.ticket.publicId,
            status: row.ticket.status,
            tier: row.ticket.tier,
            checkedInAt: row.ticket.eventCheckedInAt,
          }
        : null,
      paymentStatus: row.purchase?.status ?? 'UNKNOWN',
      formResponses: row.registration.formResponses,
    };

    if (isLead || isSuperAdmin) {
      // Event Lead & Super Admin operational view: includes attendee contact/profile info
      return {
        ...base,
        attendee: {
          id: row.participant.id,
          name: row.participant.name,
          email: row.participant.email,
          phone: row.participant.phone,
          isStudent: Boolean(row.participant.isStudent),
          institutionName: row.participant.institutionName,
          institutionId: row.participant.institutionId,
        },
      };
    } else {
      // Volunteer minimal operational view: only name and operational status
      return {
        ...base,
        attendee: {
          id: row.participant.id,
          name: row.participant.name,
        },
      };
    }
  });

  return {
    items: serialized,
    page,
    pageSize,
    total,
  };
}

export interface LeadEventUpdateInput {
  title?: string;
  shortDescription?: string;
  description?: string;
  rules?: string;
  venue?: string;
  organizer?: string;
  eligibility?: string;
  timeline?: any[];
  prizes?: any[];
  metadata?: Record<string, any>;
  formSchema?: any[];
  form_schema?: any[];
  registrationClosesAt?: number;
  registration_closes_at?: number;
}

const SYSTEM_ONLY_FIELDS = new Set([
  'role',
  'staff',
  'assignedBy',
  'assigned_by',
  'payment',
  'tickets',
  'seatsTaken',
  'seats_taken',
  'createdAt',
  'created_at',
  'createdBy',
  'created_by',
  'id',
]);

/**
 * Allows Event Leads to update their event details with full autonomy,
 * while preventing edge-case invalidations (e.g. invalid capacity drops,
 * changing team mode/formats when registrations exist, or shrinking team
 * sizes below already-registered team sizes).
 */
export async function updateEventOperationalDetails(
  staffUser: UserSelect,
  eventId: string,
  input: Record<string, any>
) {
  const { event, isLead, isSuperAdmin } = await verifyEventStaffAccess(staffUser, eventId);

  // Volunteers cannot edit event configuration
  if (!isLead && !isSuperAdmin) {
    throw AppError.forbidden(
      'Volunteers are not permitted to edit event metadata. Only Event Leads or Super Admins can update event details.',
      'VOLUNTEER_CANNOT_EDIT_EVENT'
    );
  }

  // Reject system-only or unrelated fields (staff/roles/accounting internals)
  for (const key of Object.keys(input)) {
    if (SYSTEM_ONLY_FIELDS.has(key)) {
      throw AppError.forbidden(
        `Field '${key}' is managed by system/admin and cannot be modified here.`,
        'FIELD_NOT_ALLOWED'
      );
    }
  }

  // Check active registrations count
  const [regCountResult] = await db
    .select({ total: count() })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
      )
    );

  const activeRegistrationsCount = Number(regCountResult?.total || 0);
  const hasActiveRegistrations = activeRegistrationsCount > 0;

  // 1. Capacity Integrity Check
  const newCapacity = input.capacity !== undefined ? input.capacity : undefined;
  if (newCapacity !== undefined && newCapacity !== null) {
    if (typeof newCapacity !== 'number' || newCapacity < 1) {
      throw AppError.badRequest('Capacity must be a positive integer or null (unlimited).', 'INVALID_CAPACITY');
    }
    if (newCapacity < event.seatsTaken) {
      throw AppError.badRequest(
        `Cannot reduce capacity to ${newCapacity}. Current seats taken is ${event.seatsTaken}.`,
        'CAPACITY_BELOW_OCCUPANCY'
      );
    }
  }

  // 2. Format / Team Mode / Price Model Invariants (Locked when registrations exist)
  if (hasActiveRegistrations) {
    if (input.format !== undefined && input.format !== event.format) {
      throw AppError.badRequest(
        `Cannot change event format to '${input.format}' because ${activeRegistrationsCount} active registration(s) already exist.`,
        'CANNOT_CHANGE_FORMAT_WITH_REGISTRATIONS'
      );
    }
    const isTeamInput = input.isTeam ?? input.is_team;
    if (isTeamInput !== undefined && (isTeamInput ? 1 : 0) !== event.isTeam) {
      throw AppError.badRequest(
        `Cannot change event team mode because ${activeRegistrationsCount} active registration(s) already exist.`,
        'CANNOT_CHANGE_FORMAT_WITH_REGISTRATIONS'
      );
    }
    const priceModelInput = input.priceModel ?? input.price_model;
    if (priceModelInput !== undefined && priceModelInput !== event.priceModel) {
      throw AppError.badRequest(
        `Cannot change price model because ${activeRegistrationsCount} active registration(s) already exist.`,
        'CANNOT_CHANGE_PRICE_MODEL_WITH_REGISTRATIONS'
      );
    }
  }

  // 3. Team Size Invariants (minTeamSize, maxTeamSize)
  const newMin = input.minTeamSize ?? input.min_team_size;
  const newMax = input.maxTeamSize ?? input.max_team_size;
  const effectiveMin = newMin !== undefined ? newMin : event.minTeamSize;
  const effectiveMax = newMax !== undefined ? newMax : event.maxTeamSize;

  if (newMin !== undefined && newMin < 1) {
    throw AppError.badRequest('Minimum team size must be at least 1.', 'INVALID_TEAM_SIZE');
  }
  if (effectiveMax < effectiveMin) {
    throw AppError.badRequest(
      `Maximum team size (${effectiveMax}) cannot be less than minimum team size (${effectiveMin}).`,
      'INVALID_TEAM_SIZE'
    );
  }

  if (hasActiveRegistrations && (newMin !== undefined || newMax !== undefined)) {
    const registeredTeams = await db
      .select({
        teamId: registrations.teamId,
        teamName: teams.name,
        memberCount: count(teamMembers.id),
      })
      .from(registrations)
      .innerJoin(teams, eq(registrations.teamId, teams.id))
      .innerJoin(teamMembers, eq(teams.id, teamMembers.teamId))
      .where(
        and(
          eq(registrations.eventId, eventId),
          inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
        )
      )
      .groupBy(registrations.teamId, teams.name);

    for (const team of registeredTeams) {
      const mCount = Number(team.memberCount);
      if (newMin !== undefined && mCount < newMin) {
        throw AppError.badRequest(
          `Cannot increase minTeamSize to ${newMin}. Team '${team.teamName}' has already registered with only ${mCount} member(s).`,
          'MIN_TEAM_SIZE_CONFLICT'
        );
      }
      if (newMax !== undefined && mCount > newMax) {
        throw AppError.badRequest(
          `Cannot decrease maxTeamSize to ${newMax}. Team '${team.teamName}' has already registered with ${mCount} members.`,
          'MAX_TEAM_SIZE_CONFLICT'
        );
      }
    }
  }

  // Build Updates
  const updates: Partial<typeof events.$inferInsert> = {
    updatedAt: Date.now(),
  };

  if (input.title) updates.title = input.title.trim();
  if (input.slug) updates.slug = input.slug.trim();
  if (input.category) updates.category = input.category;
  if (input.format) updates.format = input.format;

  const isTeam = input.isTeam ?? input.is_team;
  if (isTeam !== undefined) updates.isTeam = isTeam ? 1 : 0;

  const priceModel = input.priceModel ?? input.price_model;
  if (priceModel) updates.priceModel = priceModel;

  const pricePaise = input.pricePaise ?? input.price_paise;
  if (pricePaise !== undefined) {
    if (pricePaise < 0) throw AppError.badRequest('Price cannot be negative.', 'INVALID_PRICE');
    updates.pricePaise = pricePaise;
  }

  const studentPricePaise = input.studentPricePaise ?? input.student_price_paise;
  if (studentPricePaise !== undefined) {
    if (studentPricePaise < 0) throw AppError.badRequest('Student price cannot be negative.', 'INVALID_PRICE');
    updates.studentPricePaise = studentPricePaise;
  }

  if (newMin !== undefined) updates.minTeamSize = newMin;
  if (newMax !== undefined) updates.maxTeamSize = newMax;
  if (input.capacity !== undefined) updates.capacity = input.capacity;

  const capUnit = input.capacityUnit ?? input.capacity_unit;
  if (capUnit) updates.capacityUnit = capUnit;

  if (input.shortDescription !== undefined) updates.shortDescription = input.shortDescription;
  if (input.description !== undefined) updates.description = input.description;

  // Rules: accepts either a string (with \n or markdown) or an array of strings
  if (input.rules !== undefined) {
    if (Array.isArray(input.rules)) {
      updates.rules = input.rules.join('\n');
    } else if (typeof input.rules === 'string') {
      updates.rules = input.rules;
    } else {
      updates.rules = String(input.rules);
    }
  }

  if (input.venue !== undefined) updates.venue = input.venue.trim();
  if (input.organizer !== undefined) updates.organizer = input.organizer.trim();
  if (input.eligibility !== undefined) updates.eligibility = input.eligibility;
  if (input.timeline !== undefined) updates.timeline = input.timeline;
  if (input.prizes !== undefined) updates.prizes = input.prizes;
  if (input.metadata !== undefined) updates.metadata = input.metadata;
  if (input.status) updates.status = input.status;

  const volunteersCanScore = input.volunteersCanScore ?? input.volunteers_can_score;
  if (volunteersCanScore !== undefined) updates.volunteersCanScore = volunteersCanScore ? 1 : 0;

  // Schedule & Timing
  const festDay = input.festDay ?? input.fest_day;
  if (festDay !== undefined) updates.festDay = festDay;

  const startsAt = input.startsAt ?? input.starts_at;
  if (startsAt !== undefined) updates.startsAt = startsAt;

  const endsAt = input.endsAt ?? input.ends_at;
  if (endsAt !== undefined) updates.endsAt = endsAt;

  const regOpens = input.registrationOpensAt ?? input.registration_opens_at;
  if (regOpens !== undefined) updates.registrationOpensAt = regOpens;

  const regCloses = input.registrationClosesAt ?? input.registration_closes_at;
  if (regCloses !== undefined) updates.registrationClosesAt = regCloses;

  const effectiveStartsAt = updates.startsAt ?? event.startsAt;
  const effectiveEndsAt = updates.endsAt ?? event.endsAt;
  if (effectiveStartsAt && effectiveEndsAt && effectiveStartsAt > effectiveEndsAt) {
    throw AppError.badRequest('Event start time cannot be after end time.', 'INVALID_SCHEDULE');
  }

  const effectiveRegOpens = updates.registrationOpensAt ?? event.registrationOpensAt;
  const effectiveRegCloses = updates.registrationClosesAt ?? event.registrationClosesAt;
  if (effectiveRegOpens && effectiveRegCloses && effectiveRegOpens > effectiveRegCloses) {
    throw AppError.badRequest('Registration opening time cannot be after closing time.', 'INVALID_REGISTRATION_WINDOW');
  }

  // Form Schema
  const rawSchema = input.formSchema ?? input.form_schema;
  if (rawSchema !== undefined) {
    if (hasActiveRegistrations && !isSuperAdmin) {
      throw AppError.badRequest(
        'Active registrations already exist for this event. Form schema cannot be modified after registrations begin.',
        'FORM_SCHEMA_LOCKED'
      );
    }

    const validatedSchema = validateFormSchema(rawSchema);
    updates.formSchema = validatedSchema;
  }

  const [updatedEvent] = await db
    .update(events)
    .set(updates)
    .where(eq(events.id, eventId))
    .returning();

  // Audit Logging
  await db.insert(auditLogs).values({
    actorId: staffUser.id,
    action: 'EVENT_UPDATED_BY_LEAD',
    targetType: 'EVENT',
    targetId: eventId,
    details: { updates },
    createdAt: Date.now(),
  });

  return updatedEvent;
}

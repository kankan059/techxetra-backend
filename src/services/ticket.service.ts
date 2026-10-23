import { eq, and, sql, desc, gt } from 'drizzle-orm';
import { db } from '../db';
import {
  tickets,
  checkInLogs,
  events,
  users,
  teams,
  registrations,
  eventStaff,
  gateStaff,
} from '../db/schema';
import { AppError } from '../common/errors';
import { signTicketQr, verifyTicketQr } from '../lib/crypto';
import type { UserSelect } from '../types/express';

export async function getUserTickets(userId: string) {
  const userTickets = await db
    .select({
      ticket: tickets,
      event: {
        id: events.id,
        slug: events.slug,
        title: events.title,
        category: events.category,
        venue: events.venue,
        festDay: events.festDay,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
      },
      registration: {
        id: registrations.id,
        status: registrations.status,
        teamId: registrations.teamId,
      },
    })
    .from(tickets)
    .leftJoin(events, eq(tickets.eventId, events.id))
    .leftJoin(registrations, eq(tickets.registrationId, registrations.id))
    .where(eq(tickets.beneficiaryId, userId))
    .orderBy(desc(tickets.createdAt));

  return userTickets.map((row) => ({
    ...row.ticket,
    qrToken: signTicketQr(row.ticket.id, row.ticket.qrVersion),
    event: row.event,
    registration: row.registration,
  }));
}

export async function getTicketById(ticketId: string, requestingUser: UserSelect) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) {
    throw AppError.notFound(`Ticket '${ticketId}' not found`);
  }

  const isSuperAdmin = requestingUser.role === 'SUPER_ADMIN';
  const isBeneficiary = ticket.beneficiaryId === requestingUser.id;

  if (!isSuperAdmin && !isBeneficiary) {
    throw AppError.notFound(`Ticket '${ticketId}' not found`);
  }

  const [event] = ticket.eventId
    ? await db.select().from(events).where(eq(events.id, ticket.eventId)).limit(1)
    : [null];

  const [beneficiary] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      isStudent: users.isStudent,
      institutionName: users.institutionName,
    })
    .from(users)
    .where(eq(users.id, ticket.beneficiaryId))
    .limit(1);

  return {
    ...ticket,
    qrToken: signTicketQr(ticket.id, ticket.qrVersion),
    event,
    beneficiary,
  };
}

export interface ScanContextInput {
  qrToken?: string;
  qr_token?: string;
  qrPayload?: string;
  qr_payload?: string;
  context?: 'GATE' | 'EVENT';
  eventId?: string;
  event_id?: string;
  studentIdChecked?: boolean;
  student_id_checked?: boolean;
  deviceId?: string;
}

/**
 * Checks whether staff user is authorized to scan at GATE or EVENT.
 */
export async function verifyStaffScanPermission(
  staffUser: UserSelect,
  context: 'GATE' | 'EVENT',
  eventId?: string
) {
  if (staffUser.role === 'SUPER_ADMIN') {
    return true; // Super admin has global venue access
  }

  if (context === 'GATE') {
    const [staffRecord] = await db
      .select()
      .from(gateStaff)
      .where(eq(gateStaff.userId, staffUser.id))
      .limit(1);

    if (!staffRecord) {
      throw AppError.forbidden(
        'You are not authorized for Gate admission scanning.',
        'UNAUTHORIZED_GATE_STAFF'
      );
    }
    return true;
  }

  // context === 'EVENT'
  if (!eventId) {
    throw AppError.badRequest('eventId is required for event check-in scanning');
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
      'You are not assigned as staff to this specific event.',
      'NOT_ASSIGNED_TO_EVENT'
    );
  }

  return true;
}

/**
 * Pre-scan inspection: validates QR token without consuming the ticket.
 */
export async function preScanLookup(staffUser: UserSelect, input: ScanContextInput) {
  const token = input.qrToken || input.qr_token || input.qrPayload || input.qr_payload;
  if (!token) throw AppError.badRequest('qrToken is required');

  const context = input.context || 'EVENT';
  const eventId = input.eventId || input.event_id;

  // 1. Verify staff scanning authorization
  await verifyStaffScanPermission(staffUser, context, eventId);

  // 2. Cryptographic signature check
  const verification = verifyTicketQr(token);
  if (!verification.valid || !verification.ticketId || !verification.version) {
    throw AppError.badRequest('Invalid or tampered QR ticket code', 'INVALID_QR_TOKEN');
  }

  // 3. Ticket existence and version check
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, verification.ticketId)).limit(1);
  if (!ticket) {
    throw AppError.notFound('Ticket not found in database', 'TICKET_NOT_FOUND');
  }

  if (ticket.status === 'REVOKED' || ticket.status === 'CANCELLED' || ticket.status === 'VOID') {
    return {
      canAdmit: false,
      outcome: 'REVOKED',
      reason: `Ticket has been revoked (${ticket.status})`,
      ticketStatus: ticket.status,
    };
  }

  if (ticket.qrVersion !== verification.version) {
    return {
      canAdmit: false,
      outcome: 'INVALID',
      reason: 'QR code version expired. A newer QR code has been generated for this ticket.',
      ticketStatus: ticket.status,
    };
  }

  // 4. Time validity
  const now = Date.now();
  if (ticket.validFrom && now < ticket.validFrom) {
    return {
      canAdmit: false,
      outcome: 'NOT_YET_VALID',
      reason: 'Ticket validity window has not started yet',
      validFrom: ticket.validFrom,
    };
  }
  if (ticket.validTo && now > ticket.validTo) {
    return {
      canAdmit: false,
      outcome: 'INVALID',
      reason: 'Ticket validity window has expired',
      validTo: ticket.validTo,
    };
  }

  // 5. Event check-in eligibility
  if (context === 'EVENT') {
    if (ticket.eventId && eventId && ticket.eventId !== eventId) {
      return {
        canAdmit: false,
        outcome: 'WRONG_EVENT',
        reason: 'Ticket was purchased for a different event',
      };
    }

    if (ticket.eventCheckedInAt !== null) {
      return {
        canAdmit: false,
        outcome: 'ALREADY_USED',
        reason: 'Attendee has already been checked into this event',
        checkedInAt: ticket.eventCheckedInAt,
      };
    }
  }

  // 6. Anti-passback warning for gate entry
  const warnings: string[] = [];
  if (context === 'GATE') {
    const fifteenMinsAgo = now - 15 * 60 * 1000;
    const [recentGateScan] = await db
      .select()
      .from(checkInLogs)
      .where(
        and(
          eq(checkInLogs.ticketId, ticket.id),
          eq(checkInLogs.context, 'GATE'),
          eq(checkInLogs.verdict, 'ADMITTED'),
          gt(checkInLogs.createdAt, fifteenMinsAgo)
        )
      )
      .limit(1);

    if (recentGateScan) {
      warnings.push('Pass was scanned at the gate within the last 15 minutes. Check for badge pass-back.');
    }
  }

  // 7. Attendee details (Privacy-tiered)
  const [attendee] = await db.select().from(users).where(eq(users.id, ticket.beneficiaryId)).limit(1);
  const isPrivilegedStaff = staffUser.role === 'SUPER_ADMIN' || staffUser.role === 'EVENT_LEAD' || staffUser.role === 'LEAD';

  const attendeeDto = isPrivilegedStaff
    ? {
        name: attendee?.name || 'Attendee',
        email: attendee?.email,
        phone: attendee?.phone,
        institutionName: attendee?.institutionName,
        institutionId: attendee?.institutionId,
      }
    : {
        name: attendee?.name || 'Attendee',
      };

  return {
    canAdmit: true,
    outcome: 'ACCEPTED',
    ticketId: ticket.id,
    ticketPublicId: ticket.publicId,
    ticketTier: ticket.tier,
    requiresIdCheck: ticket.tier === 'STUDENT',
    attendee: attendeeDto,
    warnings,
  };
}

/**
 * Executes physical admission and logs the check-in atomically.
 */
export async function executeAdmission(staffUser: UserSelect, input: ScanContextInput) {
  const token = input.qrToken || input.qr_token || input.qrPayload || input.qr_payload;
  if (!token) throw AppError.badRequest('qrToken is required');

  const context = input.context || 'EVENT';
  const eventId = input.eventId || input.event_id;
  const studentIdChecked = input.studentIdChecked === true || input.student_id_checked === true;
  const deviceId = input.deviceId;

  // 1. Verify staff scanning authorization
  await verifyStaffScanPermission(staffUser, context, eventId);

  // 2. Cryptographic signature check
  const verification = verifyTicketQr(token);
  if (!verification.valid || !verification.ticketId || !verification.version) {
    throw AppError.badRequest('Invalid or tampered QR ticket code', 'INVALID_QR_TOKEN');
  }

  const now = Date.now();

  // 3. Execute in interactive PostgreSQL transaction with row lock
  return await db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(tickets)
      .where(eq(tickets.id, verification.ticketId!))
      .for('update');

    if (!ticket) throw AppError.notFound('Ticket not found', 'TICKET_NOT_FOUND');

    if (ticket.status === 'REVOKED' || ticket.status === 'CANCELLED' || ticket.status === 'VOID') {
      await tx.insert(checkInLogs).values({
        ticketId: ticket.id,
        scannedBy: staffUser.id,
        context,
        eventId: eventId ?? ticket.eventId,
        verdict: 'DENIED',
        outcome: 'REVOKED',
        notes: `Ticket revoked (${ticket.status})`,
        deviceId,
        createdAt: now,
      });
      throw AppError.badRequest(`Ticket has been revoked (${ticket.status})`, 'TICKET_REVOKED');
    }

    if (ticket.qrVersion !== verification.version) {
      await tx.insert(checkInLogs).values({
        ticketId: ticket.id,
        scannedBy: staffUser.id,
        context,
        eventId: eventId ?? ticket.eventId,
        verdict: 'DENIED',
        outcome: 'INVALID',
        notes: 'QR code version expired',
        deviceId,
        createdAt: now,
      });
      throw AppError.badRequest('QR code version expired', 'TICKET_INVALID');
    }

    // Student ID Check Enforcement
    if (ticket.tier === 'STUDENT' && !studentIdChecked) {
      throw AppError.badRequest(
        'Student ID card verification is mandatory for student passes. Please inspect physical ID before admitting.',
        'STUDENT_ID_CHECK_REQUIRED'
      );
    }

    if (context === 'EVENT') {
      if (ticket.eventId && eventId && ticket.eventId !== eventId) {
        await tx.insert(checkInLogs).values({
          ticketId: ticket.id,
          scannedBy: staffUser.id,
          context: 'EVENT',
          eventId,
          verdict: 'DENIED',
          outcome: 'WRONG_EVENT',
          notes: 'Wrong event ticket scanned',
          deviceId,
          createdAt: now,
        });
        throw AppError.badRequest('Ticket is for a different event', 'WRONG_EVENT');
      }

      // Check single-use event check-in
      if (ticket.eventCheckedInAt !== null) {
        await tx.insert(checkInLogs).values({
          ticketId: ticket.id,
          scannedBy: staffUser.id,
          context: 'EVENT',
          eventId: eventId ?? ticket.eventId,
          verdict: 'DENIED',
          outcome: 'ALREADY_USED',
          notes: 'Pass already admitted to this event',
          deviceId,
          createdAt: now,
        });
        throw AppError.conflict('Ticket has already been admitted to this event', 'TICKET_ALREADY_USED');
      }

      // Mark ticket admitted
      await tx
        .update(tickets)
        .set({
          eventCheckedInAt: now,
          status: 'USED',
          updatedAt: now,
        })
        .where(eq(tickets.id, ticket.id));
    }

    // Insert admission log
    const [log] = await tx
      .insert(checkInLogs)
      .values({
        ticketId: ticket.id,
        scannedBy: staffUser.id,
        context,
        eventId: eventId ?? ticket.eventId,
        verdict: 'ADMITTED',
        outcome: 'ACCEPTED',
        notes: 'Admitted successfully',
        deviceId,
        createdAt: now,
      })
      .returning();

    return {
      admitted: true,
      outcome: 'ACCEPTED',
      checkInId: log.id,
      ticketPublicId: ticket.publicId,
      admittedAt: now,
    };
  });
}

/**
 * Super Admin ticket lifecycle overrides (revoke, rotate, undo-checkin).
 */
export async function revokeTicket(ticketId: string, adminUser: UserSelect) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw AppError.notFound(`Ticket '${ticketId}' not found`);

  const [updated] = await db
    .update(tickets)
    .set({
      status: 'REVOKED',
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(tickets.id, ticketId))
    .returning();

  return updated;
}

export async function rotateTicketQr(ticketId: string, adminUser: UserSelect) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw AppError.notFound(`Ticket '${ticketId}' not found`);

  const nextVersion = ticket.qrVersion + 1;
  const [updated] = await db
    .update(tickets)
    .set({
      qrVersion: nextVersion,
      updatedAt: Date.now(),
    })
    .where(eq(tickets.id, ticketId))
    .returning();

  return {
    ...updated,
    newQrToken: signTicketQr(updated.id, updated.qrVersion),
  };
}

export async function undoCheckIn(ticketId: string, adminUser: UserSelect, reason: string) {
  if (!reason || reason.trim().length < 5) {
    throw AppError.badRequest('A valid audit reason of at least 5 characters is required to undo a check-in');
  }

  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!ticket) throw AppError.notFound(`Ticket '${ticketId}' not found`);

  if (!ticket.eventCheckedInAt) {
    throw AppError.badRequest('Ticket has not been checked in');
  }

  const [updated] = await db
    .update(tickets)
    .set({
      eventCheckedInAt: null,
      status: 'ACTIVE',
      updatedAt: Date.now(),
    })
    .where(eq(tickets.id, ticketId))
    .returning();

  // Log reversal in checkInLogs
  await db.insert(checkInLogs).values({
    ticketId: ticket.id,
    scannedBy: adminUser.id,
    context: 'EVENT',
    eventId: ticket.eventId,
    verdict: 'DENIED',
    outcome: 'REVOKED',
    notes: `CHECK-IN UNDONE BY ADMIN (${adminUser.name}): ${reason}`,
    createdAt: Date.now(),
  });

  return {
    message: 'Check-in undone successfully. Ticket returned to ACTIVE status.',
    ticket: updated,
  };
}

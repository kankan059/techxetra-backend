import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  events,
  esportsScores,
  esportsScoreHistory,
  esportsMatches,
  registrations,
  eventStaff,
  auditLogs,
  users,
  teams,
} from '../db/schema';
import { AppError } from '../common/errors';
import type { UserSelect } from '../types/express';

/**
 * Verifies that the event is an E_SPORTS event and that the staff user has scoring permissions.
 */
export async function verifyScoringPermission(
  staffUser: UserSelect,
  eventId: string,
  requiresLeadOrAdmin = false
) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw AppError.notFound(`Event '${eventId}' not found`);
  }

  // Invariant 1: Scoring is strictly restricted to E_SPORTS category
  if (event.category !== 'E_SPORTS') {
    throw AppError.badRequest(
      `Scoring is strictly restricted to E-Sports events. Event '${event.title}' is of category '${event.category}'.`,
      'NOT_AN_ESPORTS_EVENT'
    );
  }

  if (staffUser.role === 'SUPER_ADMIN') {
    return event;
  }

  // Check event staff assignment
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
    throw AppError.forbidden('You are not assigned as staff to this event', 'NOT_ASSIGNED_TO_EVENT');
  }

  const isLead = assignment.role === 'EVENT_LEAD' || assignment.role === 'LEAD';

  if (requiresLeadOrAdmin && !isLead) {
    throw AppError.forbidden(
      'Only an assigned Event Lead or Super Admin can perform this action',
      'LEAD_PERMISSION_REQUIRED'
    );
  }

  // Volunteers can only score if volunteers_can_score is enabled
  if (!isLead && event.volunteersCanScore !== 1) {
    throw AppError.forbidden(
      'Volunteer scoring is disabled for this event. Only Event Leads may enter scores.',
      'VOLUNTEERS_CANNOT_SCORE'
    );
  }

  return event;
}

export interface RecordScoreInput {
  registrationId?: string;
  registration_id?: string;
  roundNo?: number;
  round_no?: number;
  score: number;
  expectedVersion?: number;
  expected_version?: number;
  matchId?: string;
  match_id?: string;
  reason?: string;
}

/**
 * Records or updates a participant's score for a tournament round with optimistic concurrency control.
 */
export async function recordRoundScore(
  staffUser: UserSelect,
  eventId: string,
  input: RecordScoreInput
) {
  const registrationId = input.registrationId || input.registration_id;
  const roundNo = input.roundNo ?? input.round_no;
  const expectedVersion = input.expectedVersion ?? input.expected_version;
  const matchId = input.matchId || input.match_id;
  const reason = input.reason || 'Round score entry';

  if (!registrationId) throw AppError.badRequest('registrationId is required');
  if (roundNo === undefined || roundNo < 1) throw AppError.badRequest('roundNo must be >= 1');
  if (typeof input.score !== 'number' || isNaN(input.score)) {
    throw AppError.badRequest('score must be a valid number');
  }

  const event = await verifyScoringPermission(staffUser, eventId);

  // Invariant 2: Cannot modify scores if scoring is finalized
  if (event.scoringStatus === 'FINALIZED') {
    throw AppError.badRequest(
      'Tournament scoring is finalized. You must reopen scoring before making edits.',
      'SCORING_FINALIZED'
    );
  }

  // Verify registration belongs to this event
  const [reg] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.eventId, eventId)))
    .limit(1);

  if (!reg) {
    throw AppError.notFound(`Registration '${registrationId}' does not belong to this event`);
  }

  const now = Date.now();

  return await db.transaction(async (tx) => {
    // Check if score record already exists for (eventId, registrationId, roundNo)
    const [existing] = await tx
      .select()
      .from(esportsScores)
      .where(
        and(
          eq(esportsScores.eventId, eventId),
          eq(esportsScores.registrationId, registrationId),
          eq(esportsScores.roundNo, roundNo)
        )
      )
      .for('update');

    let savedScore;

    if (existing) {
      // Optimistic concurrency check
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw AppError.conflict(
          `Score was modified by another coordinator (version ${existing.version} vs expected ${expectedVersion}). Please refresh.`,
          'SCORE_VERSION_CONFLICT'
        );
      }

      const nextVersion = existing.version + 1;
      const [updated] = await tx
        .update(esportsScores)
        .set({
          score: input.score,
          version: nextVersion,
          matchId: matchId || existing.matchId,
          recordedBy: staffUser.id,
          updatedAt: now,
        })
        .where(eq(esportsScores.id, existing.id))
        .returning();

      savedScore = updated;

      // Append score history
      await tx.insert(esportsScoreHistory).values({
        scoreId: existing.id,
        eventId,
        changedBy: staffUser.id,
        oldScore: existing.score,
        newScore: input.score,
        oldVersion: existing.version,
        newVersion: nextVersion,
        reason,
        createdAt: now,
      });
    } else {
      // Insert new score record
      const [inserted] = await tx
        .insert(esportsScores)
        .values({
          eventId,
          registrationId,
          roundNo,
          score: input.score,
          version: 1,
          matchId,
          recordedBy: staffUser.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      savedScore = inserted;

      // Append score history
      await tx.insert(esportsScoreHistory).values({
        scoreId: inserted.id,
        eventId,
        changedBy: staffUser.id,
        oldScore: null,
        newScore: input.score,
        oldVersion: null,
        newVersion: 1,
        reason: 'Initial round score entry',
        createdAt: now,
      });
    }

    return savedScore;
  });
}

/**
 * Deletes a round score record and appends history.
 */
export async function deleteRoundScore(
  staffUser: UserSelect,
  eventId: string,
  scoreId: string,
  reason: string
) {
  if (!reason || reason.trim().length < 3) {
    throw AppError.badRequest('A reason of at least 3 characters is required to delete a score record');
  }

  const event = await verifyScoringPermission(staffUser, eventId);

  if (event.scoringStatus === 'FINALIZED') {
    throw AppError.badRequest('Tournament scoring is finalized. Reopen scoring before deleting records.', 'SCORING_FINALIZED');
  }

  const [existing] = await db
    .select()
    .from(esportsScores)
    .where(and(eq(esportsScores.id, scoreId), eq(esportsScores.eventId, eventId)))
    .limit(1);

  if (!existing) {
    throw AppError.notFound(`Score record '${scoreId}' not found`);
  }

  const now = Date.now();

  await db.transaction(async (tx) => {
    // Record deletion in history
    await tx.insert(esportsScoreHistory).values({
      scoreId: existing.id,
      eventId,
      changedBy: staffUser.id,
      oldScore: existing.score,
      newScore: 0,
      oldVersion: existing.version,
      newVersion: existing.version + 1,
      reason: `DELETED: ${reason}`,
      createdAt: now,
    });

    await tx.delete(esportsScores).where(eq(esportsScores.id, scoreId));
  });

  return { message: 'Score record deleted successfully' };
}

/**
 * Finalizes tournament scoring.
 */
export async function finalizeScoring(staffUser: UserSelect, eventId: string) {
  await verifyScoringPermission(staffUser, eventId, true); // Requires Lead or Super Admin

  const now = Date.now();
  const [updated] = await db
    .update(events)
    .set({
      scoringStatus: 'FINALIZED',
      leaderboardPublic: 1, // Auto-publish leaderboard on finalization
      updatedAt: now,
    })
    .where(eq(events.id, eventId))
    .returning();

  await db.insert(auditLogs).values({
    actorId: staffUser.id,
    action: 'ESPORTS_SCORING_FINALIZED',
    targetType: 'EVENT',
    targetId: eventId,
    details: { eventTitle: updated.title, scoringStatus: 'FINALIZED' },
    createdAt: now,
  });

  return updated;
}

/**
 * Reopens tournament scoring for adjustments with mandatory audit reason.
 */
export async function reopenScoring(staffUser: UserSelect, eventId: string, reason: string) {
  if (!reason || reason.trim().length < 5) {
    throw AppError.badRequest('A detailed reason of at least 5 characters is required to reopen scoring');
  }

  await verifyScoringPermission(staffUser, eventId, true); // Requires Lead or Super Admin

  const now = Date.now();
  const [updated] = await db
    .update(events)
    .set({
      scoringStatus: 'OPEN',
      updatedAt: now,
    })
    .where(eq(events.id, eventId))
    .returning();

  await db.insert(auditLogs).values({
    actorId: staffUser.id,
    action: 'ESPORTS_SCORING_REOPENED',
    targetType: 'EVENT',
    targetId: eventId,
    details: { eventTitle: updated.title, reason },
    createdAt: now,
  });

  return updated;
}

/**
 * Tournament matches management.
 */
export async function getEventMatches(staffUser: UserSelect, eventId: string) {
  await verifyScoringPermission(staffUser, eventId);

  const matches = await db
    .select({
      match: esportsMatches,
      partA: {
        id: registrations.id,
      },
    })
    .from(esportsMatches)
    .leftJoin(registrations, eq(esportsMatches.participantAId, registrations.id))
    .where(eq(esportsMatches.eventId, eventId))
    .orderBy(esportsMatches.roundNumber, esportsMatches.matchNumber);

  return matches.map((m) => m.match);
}

export async function createEventMatch(
  staffUser: UserSelect,
  eventId: string,
  input: {
    roundNumber: number;
    matchNumber: number;
    participantAId?: string;
    participantBId?: string;
    scheduledAt?: number;
  }
) {
  await verifyScoringPermission(staffUser, eventId, true);

  const now = Date.now();
  const [match] = await db
    .insert(esportsMatches)
    .values({
      eventId,
      roundNumber: input.roundNumber,
      matchNumber: input.matchNumber,
      participantAId: input.participantAId,
      participantBId: input.participantBId,
      scheduledAt: input.scheduledAt,
      status: 'SCHEDULED',
      createdBy: staffUser.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return match;
}

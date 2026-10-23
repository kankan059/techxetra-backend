import { Router, Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { events, esportsScores, registrations, users, teams } from '../db/schema';
import { sendSuccess } from '../common/response';
import { AppError } from '../common/errors';

export const leaderboardsRouter = Router();

export interface LeaderboardEntry {
  rank: number;
  registrationId: string;
  participantName: string;
  totalScore: number;
  rounds: number[];
}

/**
 * Deterministic tie-breaking comparator for esports leaderboard:
 * 1. Highest total score.
 * 2. Highest single round score.
 * 3. Next highest round score, etc.
 */
export function compareLeaderboardEntries(
  a: { totalScore: number; rounds: number[] },
  b: { totalScore: number; rounds: number[] }
): number {
  if (b.totalScore !== a.totalScore) {
    return b.totalScore - a.totalScore;
  }

  // Compare round scores in descending order
  const sortedA = [...a.rounds].sort((x, y) => y - x);
  const sortedB = [...b.rounds].sort((x, y) => y - x);

  const maxRounds = Math.max(sortedA.length, sortedB.length);
  for (let i = 0; i < maxRounds; i++) {
    const scoreA = sortedA[i] ?? 0;
    const scoreB = sortedB[i] ?? 0;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
  }

  return 0;
}

// Handler for both /leaderboards/:eventId and /events/:idOrSlug/leaderboard
export async function getLeaderboardHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const eventIdOrSlug = req.params.eventId || req.params.idOrSlug;
    if (!eventIdOrSlug) {
      throw AppError.badRequest('Event identifier is required');
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventIdOrSlug);

    const [event] = await db
      .select()
      .from(events)
      .where(isUuid ? eq(events.id, eventIdOrSlug) : eq(events.slug, eventIdOrSlug))
      .limit(1);

    if (!event) {
      throw AppError.notFound(`Event '${eventIdOrSlug}' not found`);
    }

    // Invariant 1: Only E_SPORTS category events have tournament leaderboards
    if (event.category !== 'E_SPORTS') {
      throw AppError.badRequest(
        `Leaderboard is only available for E-Sports events. Event '${event.title}' is of category '${event.category}'.`,
        'NOT_AN_ESPORTS_EVENT'
      );
    }

    // Invariant 2: Leaderboard must be marked public
    if (event.leaderboardPublic !== 1) {
      throw AppError.forbidden(
        'The leaderboard for this event is not currently published.',
        'LEADERBOARD_NOT_PUBLIC'
      );
    }

    // Fetch all scores for this event
    const rawScores = await db
      .select({
        score: esportsScores,
        registration: registrations,
        user: users,
        team: teams,
      })
      .from(esportsScores)
      .innerJoin(registrations, eq(esportsScores.registrationId, registrations.id))
      .innerJoin(users, eq(registrations.participantId, users.id))
      .leftJoin(teams, eq(registrations.teamId, teams.id))
      .where(eq(esportsScores.eventId, event.id));

    // Aggregate by registration ID
    const entryMap = new Map<
      string,
      {
        registrationId: string;
        participantName: string;
        rounds: number[];
      }
    >();

    for (const row of rawScores) {
      const regId = row.registration.id;
      if (!entryMap.has(regId)) {
        const name = row.team ? row.team.name : row.user.name;
        entryMap.set(regId, {
          registrationId: regId,
          participantName: name,
          rounds: [],
        });
      }
      entryMap.get(regId)!.rounds.push(row.score.score);
    }

    // Calculate totals
    const aggregated = Array.from(entryMap.values()).map((entry) => ({
      ...entry,
      totalScore: entry.rounds.reduce((sum, s) => sum + s, 0),
    }));

    // Sort with automated tie-breaking
    aggregated.sort(compareLeaderboardEntries);

    // Assign ranks
    let currentRank = 1;
    const rankedLeaderboard: LeaderboardEntry[] = [];

    for (let i = 0; i < aggregated.length; i++) {
      if (i > 0) {
        const prev = aggregated[i - 1];
        const curr = aggregated[i];
        if (compareLeaderboardEntries(prev, curr) !== 0) {
          currentRank = i + 1;
        }
      }

      rankedLeaderboard.push({
        rank: currentRank,
        registrationId: aggregated[i].registrationId,
        participantName: aggregated[i].participantName,
        totalScore: aggregated[i].totalScore,
        rounds: aggregated[i].rounds,
      });
    }

    sendSuccess(res, {
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        scoringStatus: event.scoringStatus,
      },
      leaderboard: rankedLeaderboard,
    });
  } catch (err) {
    next(err);
  }
}

leaderboardsRouter.get('/leaderboards/:eventId', getLeaderboardHandler);
leaderboardsRouter.get('/events/:idOrSlug/leaderboard', getLeaderboardHandler);

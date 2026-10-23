import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import {
  recordRoundScore,
  deleteRoundScore,
  finalizeScoring,
  reopenScoring,
  getEventMatches,
  createEventMatch,
} from '../services/esports.service';

export const staffEsportsRouter = Router();

const recordScoreSchema = z
  .object({
    registrationId: z.string().uuid().optional(),
    registration_id: z.string().uuid().optional(),
    roundNo: z.number().int().min(1).optional(),
    round_no: z.number().int().min(1).optional(),
    score: z.number(),
    expectedVersion: z.number().int().optional(),
    expected_version: z.number().int().optional(),
    matchId: z.string().uuid().optional(),
    match_id: z.string().uuid().optional(),
    reason: z.string().optional(),
  })
  .strict();

const reopenSchema = z
  .object({
    reason: z.string().min(5, 'A detailed reason of at least 5 characters is required'),
  })
  .strict();

const createMatchSchema = z
  .object({
    roundNumber: z.number().int().min(1),
    matchNumber: z.number().int().min(1),
    participantAId: z.string().uuid().optional(),
    participantBId: z.string().uuid().optional(),
    scheduledAt: z.number().optional(),
  })
  .strict();

// 1. POST /staff/events/:id/scores or PUT /staff/events/:id/matches/:matchId/result
staffEsportsRouter.post(
  '/staff/events/:id/scores',
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  validate({ body: recordScoreSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const score = await recordRoundScore(req.user!, id, req.body);
      sendSuccess(res, score, 201);
    } catch (err) {
      next(err);
    }
  }
);

staffEsportsRouter.put(
  '/staff/events/:id/matches/:matchId/result',
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  validate({ body: recordScoreSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const matchId = req.params.matchId as string;
      const payload = { ...req.body, matchId };
      const score = await recordRoundScore(req.user!, id, payload);
      sendSuccess(res, score, 200);
    } catch (err) {
      next(err);
    }
  }
);

// 2. DELETE /staff/events/:id/scores/:scoreId
staffEsportsRouter.delete(
  '/staff/events/:id/scores/:scoreId',
  requireAuth,
  requireRole(['EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const scoreId = req.params.scoreId as string;
      const reason = (req.query.reason as string) || (req.body?.reason as string) || 'Manual deletion';
      const result = await deleteRoundScore(req.user!, id, scoreId, reason);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 3. POST /staff/events/:id/finalize or /staff/events/:id/scoring/finalize
staffEsportsRouter.post(
  ['/staff/events/:id/finalize', '/staff/events/:id/scoring/finalize'],
  requireAuth,
  requireRole(['EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const event = await finalizeScoring(req.user!, id);
      sendSuccess(res, {
        message: 'Tournament scoring finalized and leaderboard published successfully',
        event: { id: event.id, title: event.title, scoringStatus: event.scoringStatus },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 4. POST /staff/events/:id/reopen or /staff/events/:id/scoring/reopen
staffEsportsRouter.post(
  ['/staff/events/:id/reopen', '/staff/events/:id/scoring/reopen'],
  requireAuth,
  requireRole(['EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  validate({ body: reopenSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const event = await reopenScoring(req.user!, id, req.body.reason);
      sendSuccess(res, {
        message: 'Tournament scoring reopened for updates',
        event: { id: event.id, title: event.title, scoringStatus: event.scoringStatus },
      });
    } catch (err) {
      next(err);
    }
  }
);

// 5. GET & POST /staff/events/:id/matches
staffEsportsRouter.get(
  '/staff/events/:id/matches',
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const matches = await getEventMatches(req.user!, id);
      sendSuccess(res, matches);
    } catch (err) {
      next(err);
    }
  }
);

staffEsportsRouter.post(
  '/staff/events/:id/matches',
  requireAuth,
  requireRole(['EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  validate({ body: createMatchSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const match = await createEventMatch(req.user!, id, req.body);
      sendSuccess(res, match, 201);
    } catch (err) {
      next(err);
    }
  }
);

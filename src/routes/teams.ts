import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireProfileComplete } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import { AppError } from '../common/errors';
import {
  createTeam,
  getTeamById,
  getUserTeams,
  renameTeam,
  inviteMember,
  removeMemberOrLeave,
  disbandTeam,
} from '../services/team.service';

export const teamsRouter = Router();

const createTeamSchema = z
  .object({
    eventId: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    name: z.string().min(2).max(50),
  })
  .strict()
  .refine((data) => data.eventId || data.event_id, {
    message: 'eventId is required',
    path: ['eventId'],
  });

const renameTeamSchema = z
  .object({
    name: z.string().min(2).max(50),
  })
  .strict();

const inviteMemberSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

// 1. POST /teams
teamsRouter.post(
  '/teams',
  requireAuth,
  requireProfileComplete,
  validate({ body: createTeamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const eventId = req.body.eventId || req.body.event_id;
      const team = await createTeam(req.user!, eventId, req.body.name);
      sendSuccess(res, team, 201);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /teams or /teams/mine
teamsRouter.get(['/teams', '/teams/mine'], requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userTeams = await getUserTeams(req.user!.id, req.user!.email);
    sendSuccess(res, userTeams);
  } catch (err) {
    next(err);
  }
});

// 3. GET /teams/:teamId
teamsRouter.get('/teams/:teamId', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isStaffOrAdmin = req.user!.role === 'SUPER_ADMIN' || req.user!.role === 'EVENT_LEAD' || req.user!.role === 'LEAD';
    const team = await getTeamById(req.params.teamId, req.user!.id, isStaffOrAdmin);
    sendSuccess(res, team);
  } catch (err) {
    next(err);
  }
});

// 4. PATCH /teams/:teamId
teamsRouter.patch(
  '/teams/:teamId',
  requireAuth,
  validate({ body: renameTeamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await renameTeam(req.params.teamId, req.user!.id, req.body.name);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// 5. DELETE /teams/:teamId (Disband)
teamsRouter.delete('/teams/:teamId', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await disbandTeam(req.params.teamId, req.user!.id);
    sendSuccess(res, { message: 'Team disbanded successfully' });
  } catch (err) {
    next(err);
  }
});

// 6. POST /teams/:teamId/invitations or /teams/:teamId/invite
teamsRouter.post(
  ['/teams/:teamId/invitations', '/teams/:teamId/invite'],
  requireAuth,
  validate({ body: inviteMemberSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await inviteMember(req.params.teamId, req.user!.id, req.body.email);
      sendSuccess(res, member, 201);
    } catch (err) {
      next(err);
    }
  }
);

// 7. DELETE /teams/:teamId/members/:memberId (Remove or Leave)
teamsRouter.delete('/teams/:teamId/members/:memberId', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updated = await removeMemberOrLeave(req.params.teamId, req.params.memberId, req.user!.id);
    sendSuccess(res, { message: 'Member removed or left team successfully', member: updated });
  } catch (err) {
    next(err);
  }
});

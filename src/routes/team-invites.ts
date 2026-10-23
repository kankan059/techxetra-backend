import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { sendSuccess } from '../common/response';
import { getPendingInvitations, respondToInvitation } from '../services/team.service';

export const teamInvitesRouter = Router();

// 1. GET /team-invitations/mine or /team-invites/mine
teamInvitesRouter.get(
  ['/team-invitations/mine', '/team-invites/mine'],
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invites = await getPendingInvitations(req.user!.id, req.user!.email);
      sendSuccess(res, invites);
    } catch (err) {
      next(err);
    }
  }
);

// 2. POST /team-invitations/:invitationId/accept or /team-invites/:invitationId/accept
teamInvitesRouter.post(
  ['/team-invitations/:invitationId/accept', '/team-invites/:invitationId/accept'],
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invitationId = req.params.invitationId as string;
      const member = await respondToInvitation(invitationId, req.user!, true);
      sendSuccess(res, { message: 'Invitation accepted successfully', member });
    } catch (err) {
      next(err);
    }
  }
);

// 3. POST /team-invitations/:invitationId/decline or /team-invites/:invitationId/decline
teamInvitesRouter.post(
  ['/team-invitations/:invitationId/decline', '/team-invites/:invitationId/decline'],
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invitationId = req.params.invitationId as string;
      const member = await respondToInvitation(invitationId, req.user!, false);
      sendSuccess(res, { message: 'Invitation declined', member });
    } catch (err) {
      next(err);
    }
  }
);

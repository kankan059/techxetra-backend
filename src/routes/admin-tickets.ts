import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdminOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import {
  revokeTicket,
  rotateTicketQr,
  undoCheckIn,
} from '../services/ticket.service';

export const adminTicketsRouter = Router();

const undoCheckInSchema = z
  .object({
    reason: z.string().min(5, 'A detailed reason of at least 5 characters is required'),
  })
  .strict();

// 1. POST /admin/tickets/:ticketId/revoke
adminTicketsRouter.post(
  '/admin/tickets/:ticketId/revoke',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ticket = await revokeTicket(req.params.ticketId, req.user!);
      sendSuccess(res, { message: 'Ticket revoked successfully', ticket });
    } catch (err) {
      next(err);
    }
  }
);

// 2. POST /admin/tickets/:ticketId/rotate-qr
adminTicketsRouter.post(
  '/admin/tickets/:ticketId/rotate-qr',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await rotateTicketQr(req.params.ticketId, req.user!);
      sendSuccess(res, { message: 'QR code rotated successfully', ticket: result });
    } catch (err) {
      next(err);
    }
  }
);

// 3. POST /admin/tickets/:ticketId/undo-check-in
adminTicketsRouter.post(
  '/admin/tickets/:ticketId/undo-check-in',
  requireAuth,
  requireSuperAdminOnly,
  validate({ body: undoCheckInSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await undoCheckIn(req.params.ticketId, req.user!, req.body.reason);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

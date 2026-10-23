import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { sendSuccess } from '../common/response';
import { getUserTickets, getTicketById } from '../services/ticket.service';

export const ticketsRouter = Router();

// 1. GET /tickets or /tickets/mine
ticketsRouter.get(
  ['/tickets', '/tickets/mine'],
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tickets = await getUserTickets(req.user!.id);
      sendSuccess(res, tickets);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /tickets/:ticketId
ticketsRouter.get(
  '/tickets/:ticketId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ticket = await getTicketById(req.params.ticketId, req.user!);
      sendSuccess(res, ticket);
    } catch (err) {
      next(err);
    }
  }
);

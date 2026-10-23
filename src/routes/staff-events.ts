import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { sendSuccess, sendPaginated } from '../common/response';
import {
  getAssignedEvents,
  getEventDashboard,
  getEventAttendeeRoster,
  updateEventOperationalDetails,
} from '../services/staff.service';

export const staffEventsRouter = Router();

// 1. GET /staff/events or /staff/events/mine
staffEventsRouter.get(
  ['/staff/events', '/staff/events/mine'],
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const assigned = await getAssignedEvents(req.user!);
      sendSuccess(res, assigned);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /staff/events/:eventId/dashboard
staffEventsRouter.get(
  '/staff/events/:eventId/dashboard',
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const dashboard = await getEventDashboard(req.user!, eventId);
      sendSuccess(res, dashboard);
    } catch (err) {
      next(err);
    }
  }
);

// 3. GET /staff/events/:eventId/participants or /staff/events/:eventId/registrations
staffEventsRouter.get(
  ['/staff/events/:eventId/participants', '/staff/events/:eventId/registrations'],
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50;
      const search = req.query.search as string | undefined;

      const roster = await getEventAttendeeRoster(req.user!, eventId, {
        page,
        pageSize,
        search,
      });

      sendPaginated(res, roster.items, roster.page, roster.pageSize, roster.total);
    } catch (err) {
      next(err);
    }
  }
);

// 4. PATCH /staff/events/:eventId/public-details or /staff/events/:eventId
staffEventsRouter.patch(
  ['/staff/events/:eventId/public-details', '/staff/events/:eventId'],
  requireAuth,
  requireRole(['EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const updated = await updateEventOperationalDetails(req.user!, eventId, req.body);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

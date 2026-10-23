import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdminOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import {
  createEventAdmin,
  updateEventAdmin,
  safeDeleteEventAdmin,
  assignStaffAdmin,
  removeStaffAdmin,
} from '../services/admin.service';
import { db } from '../db';
import { eventStaff, users } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const adminEventsRouter = Router();

const assignStaffSchema = z
  .object({
    userId: z.string().optional(),
    user_id: z.string().optional(),
    role: z.enum(['EVENT_LEAD', 'LEAD', 'VOLUNTEER']),
  })
  .strict();

// 1. POST /admin/events
adminEventsRouter.post(
  '/admin/events',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const newEvent = await createEventAdmin(req.user!, req.body);
      sendSuccess(res, newEvent, 201);
    } catch (err) {
      next(err);
    }
  }
);

// 2. PATCH /admin/events/:id
adminEventsRouter.patch(
  '/admin/events/:id',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await updateEventAdmin(req.user!, req.params.id, req.body);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// 3. DELETE /admin/events/:id (Safe Deletion)
adminEventsRouter.delete(
  '/admin/events/:id',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await safeDeleteEventAdmin(req.user!, req.params.id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 4. POST /admin/events/:id/publish
adminEventsRouter.post(
  '/admin/events/:id/publish',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await updateEventAdmin(req.user!, req.params.id, { status: 'OPEN' });
      sendSuccess(res, { message: 'Event published successfully', event: updated });
    } catch (err) {
      next(err);
    }
  }
);

// 5. POST /admin/events/:id/cancel
adminEventsRouter.post(
  '/admin/events/:id/cancel',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updated = await updateEventAdmin(req.user!, req.params.id, { status: 'CANCELLED' });
      sendSuccess(res, { message: 'Event cancelled successfully', event: updated });
    } catch (err) {
      next(err);
    }
  }
);

// 6. POST & PUT /admin/events/:id/staff
adminEventsRouter.post(
  '/admin/events/:id/staff',
  requireAuth,
  requireSuperAdminOnly,
  validate({ body: assignStaffSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.body.userId || req.body.user_id;
      const assignment = await assignStaffAdmin(req.user!, req.params.id, userId, req.body.role);
      sendSuccess(res, assignment, 201);
    } catch (err) {
      next(err);
    }
  }
);

adminEventsRouter.put(
  '/admin/events/:id/staff/:userId',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = req.body.role || 'VOLUNTEER';
      const assignment = await assignStaffAdmin(req.user!, req.params.id, req.params.userId, role);
      sendSuccess(res, assignment);
    } catch (err) {
      next(err);
    }
  }
);

// 7. DELETE /admin/events/:id/staff/:userId
adminEventsRouter.delete(
  '/admin/events/:id/staff/:userId',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await removeStaffAdmin(req.user!, req.params.id, req.params.userId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 8. GET /admin/events/:id/staff
adminEventsRouter.get(
  '/admin/events/:id/staff',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const staffList = await db
        .select({
          userId: eventStaff.userId,
          role: eventStaff.role,
          name: users.name,
          email: users.email,
          phone: users.phone,
          assignedAt: eventStaff.createdAt,
        })
        .from(eventStaff)
        .innerJoin(users, eq(eventStaff.userId, users.id))
        .where(and(eq(eventStaff.eventId, req.params.id), sql`${eventStaff.revokedAt} IS NULL`));

      sendSuccess(res, staffList);
    } catch (err) {
      next(err);
    }
  }
);

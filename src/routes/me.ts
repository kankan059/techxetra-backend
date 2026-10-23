import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { AppError } from '../common/errors';
import { sendSuccess } from '../common/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { checkProfileCompleteness, toUserDto } from '../services/user.service';

import { getUserTeams } from '../services/team.service';
import { getUserPurchases } from '../services/purchase.service';
import { getUserTickets } from '../services/ticket.service';

export const meRouter = Router();

const updateProfileSchema = z
  .object({
    name: z.string().min(2).optional(),
    displayName: z.string().min(2).optional(),
    phone: z
      .string()
      .regex(/^[6-9]\d{9}$/, 'Phone must be a valid 10-digit mobile number starting with 6-9')
      .optional(),
    isStudent: z.boolean().optional(),
    institutionName: z.string().min(2).optional(),
    institutionId: z.string().min(1).optional(),
    avatarUrl: z.string().url().optional(),
  })
  .strict();

// 1. GET /me
meRouter.get('/me', requireAuth, (req: Request, res: Response): void => {
  sendSuccess(res, toUserDto(req.user!));
});

// 2. PATCH /me
meRouter.patch(
  '/me',
  requireAuth,
  validate({ body: updateProfileSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const body = req.body;

      // Student Field Locking check
      const studentFieldsTouched =
        body.isStudent !== undefined ||
        body.institutionName !== undefined ||
        body.institutionId !== undefined;

      if (user.studentFieldsLocked === 1 && studentFieldsTouched) {
        throw AppError.forbidden(
          'Student status and institution fields are locked after verification and cannot be modified.',
          'STUDENT_FIELDS_LOCKED'
        );
      }

      const updates: Partial<typeof users.$inferInsert> = {
        updatedAt: Date.now(),
      };

      if (body.name || body.displayName) {
        updates.name = (body.name || body.displayName).trim();
      }
      if (body.phone !== undefined) {
        updates.phone = body.phone.trim();
      }
      if (body.isStudent !== undefined) {
        updates.isStudent = body.isStudent ? 1 : 0;
      }
      if (body.institutionName !== undefined) {
        updates.institutionName = body.institutionName.trim();
      }
      if (body.institutionId !== undefined) {
        updates.institutionId = body.institutionId.trim();
      }
      if (body.avatarUrl !== undefined) {
        updates.avatarUrl = body.avatarUrl;
      }

      // Check completeness with updated fields
      const simulatedUser = { ...user, ...updates };
      const completeness = checkProfileCompleteness(simulatedUser);
      if (completeness.isComplete && !user.profileCompletedAt) {
        updates.profileCompletedAt = Date.now();
      }

      const [updatedUser] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id))
        .returning();

      sendSuccess(res, toUserDto(updatedUser));
    } catch (err) {
      next(err);
    }
  }
);

// 3. GET /me/registrations (placeholder for Task 07)
meRouter.get('/me/registrations', requireAuth, (req: Request, res: Response): void => {
  sendSuccess(res, []);
});

// 4. GET /me/teams
meRouter.get('/me/teams', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const teams = await getUserTeams(req.user!.id, req.user!.email);
    sendSuccess(res, teams);
  } catch (err) {
    next(err);
  }
});

// 5. GET /me/purchases
meRouter.get('/me/purchases', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const purchases = await getUserPurchases(req.user!.id);
    sendSuccess(res, purchases);
  } catch (err) {
    next(err);
  }
});

// 6. GET /me/tickets
meRouter.get('/me/tickets', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tickets = await getUserTickets(req.user!.id);
    sendSuccess(res, tickets);
  } catch (err) {
    next(err);
  }
});

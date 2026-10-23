import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdminOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess, sendPaginated } from '../common/response';
import { userRoleEnum } from '../db/schema';
import { listUsers, updateUserAdmin } from '../services/admin.service';

export const adminUsersRouter = Router();

const updateUserSchema = z
  .object({
    role: z.enum(userRoleEnum.enumValues).optional(),
    isActive: z.boolean().optional(),
    is_active: z.boolean().optional(),
    studentFieldsLocked: z.boolean().optional(),
    student_fields_locked: z.boolean().optional(),
  })
  .strict();

// 1. GET /admin/users
adminUsersRouter.get(
  '/admin/users',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;
      const search = req.query.search as string | undefined;
      const role = req.query.role as string | undefined;
      const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

      const result = await listUsers({ search, role, isActive, page, pageSize });
      sendPaginated(res, result.users, result.page, result.pageSize, result.total);
    } catch (err) {
      next(err);
    }
  }
);

// 2. PATCH /admin/users/:id
adminUsersRouter.patch(
  '/admin/users/:id',
  requireAuth,
  requireSuperAdminOnly,
  validate({ body: updateUserSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isActive = req.body.isActive ?? req.body.is_active;
      const studentFieldsLocked = req.body.studentFieldsLocked ?? req.body.student_fields_locked;

      const id = req.params.id as string;
      const updated = await updateUserAdmin(req.user!, id, {
        role: req.body.role,
        isActive,
        studentFieldsLocked,
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

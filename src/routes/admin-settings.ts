import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireSuperAdminOnly } from '../middleware/auth';
import { sendSuccess } from '../common/response';
import { updateSettingAdmin, updateFestDayAdmin } from '../services/admin.service';

export const adminSettingsRouter = Router();

// 1. PATCH /admin/settings or /admin/settings/:key
adminSettingsRouter.patch(
  '/admin/settings',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updates = req.body;
      const results: Record<string, any> = {};

      for (const [key, value] of Object.entries(updates)) {
        const updated = await updateSettingAdmin(req.user!, key, value);
        results[key] = updated.value;
      }

      sendSuccess(res, results);
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.patch(
  '/admin/settings/:key',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = req.params.key as string;
      const updated = await updateSettingAdmin(req.user!, key, req.body.value);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// 2. PATCH /admin/fest-days/:dayNumber or PUT /admin/festival-days/:dayNumber
adminSettingsRouter.patch(
  ['/admin/fest-days/:dayNumber', '/admin/festival-days/:dayNumber'],
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dayNum = parseInt(req.params.dayNumber as string, 10);
      const updated = await updateFestDayAdmin(req.user!, dayNum, req.body);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

adminSettingsRouter.put(
  ['/admin/fest-days/:dayNumber', '/admin/festival-days/:dayNumber'],
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dayNum = parseInt(req.params.dayNumber as string, 10);
      const updated = await updateFestDayAdmin(req.user!, dayNum, req.body);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireSuperAdminOnly } from '../middleware/auth';
import { sendSuccess, sendPaginated } from '../common/response';
import {
  getSummaryReport,
  getFinancialReport,
  getAttendanceReport,
  listAuditLogs,
} from '../services/admin.service';

export const adminReportsRouter = Router();

// 1. GET /admin/reports/summary
adminReportsRouter.get(
  '/admin/reports/summary',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary = await getSummaryReport();
      sendSuccess(res, summary);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /admin/reports/financial
adminReportsRouter.get(
  '/admin/reports/financial',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const financial = await getFinancialReport();
      sendSuccess(res, financial);
    } catch (err) {
      next(err);
    }
  }
);

// 3. GET /admin/reports/attendance
adminReportsRouter.get(
  '/admin/reports/attendance',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const attendance = await getAttendanceReport();
      sendSuccess(res, attendance);
    } catch (err) {
      next(err);
    }
  }
);

// 4. GET /admin/audit-logs
adminReportsRouter.get(
  '/admin/audit-logs',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50;
      const action = req.query.action as string | undefined;
      const actorId = req.query.actorId as string | undefined;
      const targetType = req.query.targetType as string | undefined;

      const result = await listAuditLogs({ action, actorId, targetType, page, pageSize });
      sendPaginated(res, result.logs, result.page, result.pageSize, result.total);
    } catch (err) {
      next(err);
    }
  }
);

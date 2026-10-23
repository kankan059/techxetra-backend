import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { checkInLogs, users, tickets } from '../db/schema';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import {
  preScanLookup,
  executeAdmission,
  verifyStaffScanPermission,
} from '../services/ticket.service';

export const scannerRouter = Router();

const lookupScanSchema = z
  .object({
    qrToken: z.string().optional(),
    qr_token: z.string().optional(),
    qrPayload: z.string().optional(),
    qr_payload: z.string().optional(),
    context: z.enum(['GATE', 'EVENT']).default('EVENT'),
    eventId: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
  })
  .strict();

const admitScanSchema = z
  .object({
    qrToken: z.string().optional(),
    qr_token: z.string().optional(),
    qrPayload: z.string().optional(),
    qr_payload: z.string().optional(),
    context: z.enum(['GATE', 'EVENT']).default('EVENT'),
    eventId: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    studentIdChecked: z.boolean().optional(),
    student_id_checked: z.boolean().optional(),
    deviceId: z.string().optional(),
    client_scan_id: z.string().optional(),
  })
  .strict();

// 1. POST /staff/scan/lookup
scannerRouter.post(
  '/staff/scan/lookup',
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  validate({ body: lookupScanSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await preScanLookup(req.user!, req.body);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 2. POST /staff/scan/check-in or /staff/scan/admit
scannerRouter.post(
  ['/staff/scan/check-in', '/staff/scan/admit'],
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  validate({ body: admitScanSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await executeAdmission(req.user!, req.body);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 3. GET /staff/events/:eventId/check-ins
scannerRouter.get(
  '/staff/events/:eventId/check-ins',
  requireAuth,
  requireRole(['VOLUNTEER', 'EVENT_LEAD', 'LEAD', 'SUPER_ADMIN']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { eventId } = req.params;
      await verifyStaffScanPermission(req.user!, 'EVENT', eventId);

      const logs = await db
        .select({
          id: checkInLogs.id,
          ticketId: checkInLogs.ticketId,
          scannedBy: checkInLogs.scannedBy,
          scannerName: users.name,
          context: checkInLogs.context,
          verdict: checkInLogs.verdict,
          outcome: checkInLogs.outcome,
          notes: checkInLogs.notes,
          deviceId: checkInLogs.deviceId,
          scannedAt: checkInLogs.createdAt,
          ticketPublicId: tickets.publicId,
        })
        .from(checkInLogs)
        .leftJoin(users, eq(checkInLogs.scannedBy, users.id))
        .leftJoin(tickets, eq(checkInLogs.ticketId, tickets.id))
        .where(eq(checkInLogs.eventId, eventId))
        .orderBy(desc(checkInLogs.createdAt))
        .limit(100);

      sendSuccess(res, logs);
    } catch (err) {
      next(err);
    }
  }
);

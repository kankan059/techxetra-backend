import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { payments, purchases, purchaseItems, paymentAuditLogs, users } from '../db/schema';
import { requireAuth, requireSuperAdminOnly } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import { AppError } from '../common/errors';
import {
  getPaymentReviewQueue,
  reviewPaymentSubmission,
  fulfillTicketsForPurchase,
} from '../services/payment.service';

export const adminPaymentsRouter = Router();

const reviewDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'APPROVED', 'REJECT', 'REJECTED', 'HOLD', 'ON_HOLD', 'UNHOLD']),
    reasonCode: z.string().optional(),
    rejectionReason: z.string().optional(),
    internalNote: z.string().optional(),
    privateNote: z.string().optional(),
  })
  .strict();

// 1. GET /admin/payments
adminPaymentsRouter.get(
  '/admin/payments',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = req.query.status as string | undefined;
      const validStatuses = ['SUBMITTED', 'PENDING', 'ON_HOLD', 'APPROVED', 'SUCCESS', 'REJECTED', 'WITHDRAWN'];
      if (status && !validStatuses.includes(status)) {
        throw AppError.badRequest('Invalid payment status filter');
      }
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20;

      const queue = await getPaymentReviewQueue(status, page, pageSize);
      sendSuccess(res, queue);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /admin/payments/:id
adminPaymentsRouter.get(
  '/admin/payments/:id',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
      if (!payment) throw AppError.notFound(`Payment '${id}' not found`);

      const [purchase] = await db.select().from(purchases).where(eq(purchases.id, payment.purchaseId)).limit(1);
      const items = await db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, payment.purchaseId));
      const audit = await db.select().from(paymentAuditLogs).where(eq(paymentAuditLogs.paymentId, payment.id));
      const [buyer] = await db.select().from(users).where(eq(users.id, payment.submittedBy)).limit(1);

      sendSuccess(res, {
        payment,
        purchase,
        items,
        buyer: buyer ? { id: buyer.id, name: buyer.name, email: buyer.email, phone: buyer.phone, isStudent: buyer.isStudent, institutionName: buyer.institutionName } : null,
        auditLogs: audit,
      });
    } catch (err) {
      next(err);
    }
  }
);

// 3. POST /admin/payments/:id/decision or /admin/payments/:id/review
adminPaymentsRouter.post(
  ['/admin/payments/:id/decision', '/admin/payments/:id/review'],
  requireAuth,
  requireSuperAdminOnly,
  validate({ body: reviewDecisionSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const result = await reviewPaymentSubmission(
        id,
        req.user!,
        req.body,
        req.requestId
      );
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 4. POST /admin/purchases/:id/retry-fulfillment
adminPaymentsRouter.post(
  '/admin/purchases/:id/retry-fulfillment',
  requireAuth,
  requireSuperAdminOnly,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = req.params.id as string;
      const count = await fulfillTicketsForPurchase(id);
      sendSuccess(res, { message: 'Ticket fulfillment completed successfully', fulfilledCount: count });
    } catch (err) {
      next(err);
    }
  }
);

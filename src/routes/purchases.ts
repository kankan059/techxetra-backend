import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireProfileComplete } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import { env } from '../config/env';
import {
  createPurchase,
  getUserPurchases,
  getPurchaseById,
  cancelPurchase,
} from '../services/purchase.service';

export const purchasesRouter = Router();

const purchaseItemSchema = z
  .object({
    itemType: z.enum(['GATE_PASS', 'EVENT_PASS']).optional(),
    item_type: z.enum(['GATE_PASS', 'EVENT_PASS']).optional(),
    eventId: z.string().uuid().optional(),
    event_id: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    team_id: z.string().uuid().optional(),
    participantUserId: z.string().optional(),
    participant_user_id: z.string().optional(),
    formResponse: z.record(z.any()).optional(),
    form_response: z.record(z.any()).optional(),
  })
  .strict();

const createPurchaseSchema = z
  .object({
    items: z.array(purchaseItemSchema).min(1, 'Order must contain at least one item'),
    idempotencyKey: z.string().optional(),
    idempotency_key: z.string().optional(),
    acknowledgeStudentIdPolicy: z.boolean().optional(),
    acknowledge_student_id_policy: z.boolean().optional(),
  })
  .strict();

// 1. POST /purchases
purchasesRouter.post(
  '/purchases',
  requireAuth,
  requireProfileComplete,
  validate({ body: createPurchaseSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const order = await createPurchase(req.user!, req.body);
      sendSuccess(res, order, 201);
    } catch (err) {
      next(err);
    }
  }
);

// 2. GET /purchases or /purchases/mine
purchasesRouter.get(
  ['/purchases', '/purchases/mine'],
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userPurchases = await getUserPurchases(req.user!.id);
      sendSuccess(res, userPurchases);
    } catch (err) {
      next(err);
    }
  }
);

// 3. GET /purchases/:purchaseId
purchasesRouter.get(
  '/purchases/:purchaseId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuperAdmin = req.user!.role === 'SUPER_ADMIN';
      const purchase = await getPurchaseById(req.params.purchaseId, req.user!.id, isSuperAdmin);
      sendSuccess(res, purchase);
    } catch (err) {
      next(err);
    }
  }
);

// 4. POST /purchases/:purchaseId/cancel
purchasesRouter.post(
  '/purchases/:purchaseId/cancel',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await cancelPurchase(req.params.purchaseId, req.user!.id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

// 5. GET /purchases/:purchaseId/payment
purchasesRouter.get(
  '/purchases/:purchaseId/payment',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuperAdmin = req.user!.role === 'SUPER_ADMIN';
      const purchase = await getPurchaseById(req.params.purchaseId, req.user!.id, isSuperAdmin);

      const instructions = {
        purchaseId: purchase.id,
        publicId: purchase.publicId,
        status: purchase.status,
        totalAmountPaise: purchase.totalAmountPaise,
        totalAmountInr: purchase.totalAmountPaise / 100,
        currency: purchase.currency,
        reservationExpiresAt: purchase.reservationExpiresAt,
        upi: {
          vpa: env.UPI_VPA,
          payeeName: env.UPI_PAYEE_NAME,
          amountPaise: purchase.totalAmountPaise,
          orderRef: purchase.publicId,
        },
      };

      sendSuccess(res, instructions);
    } catch (err) {
      next(err);
    }
  }
);

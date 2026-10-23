import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { sendSuccess } from '../common/response';
import {
  submitUpiPayment,
  withdrawPaymentSubmission,
} from '../services/payment.service';

export const paymentsRouter = Router();

const submitPaymentSchema = z
  .object({
    transactionId: z.string().optional(),
    transaction_id: z.string().optional(),
    utr: z.string().optional(),
    idempotencyKey: z.string().optional(),
    idempotency_key: z.string().optional(),
  })
  .strict()
  .refine((data) => data.transactionId || data.transaction_id || data.utr, {
    message: 'transactionId (UTR) is required',
    path: ['transactionId'],
  });

// 1. POST /purchases/:id/payment or /purchases/:id/payment-submissions
paymentsRouter.post(
  ['/purchases/:id/payment', '/purchases/:id/payment-submissions'],
  requireAuth,
  validate({ body: submitPaymentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const utr = req.body.transactionId || req.body.transaction_id || req.body.utr;
      const payment = await submitUpiPayment(req.params.id, req.user!, utr);
      sendSuccess(res, payment, 201);
    } catch (err) {
      next(err);
    }
  }
);

// 2. POST /purchases/:id/payment/withdraw or /purchases/:id/payment-submissions/:subId/withdraw
paymentsRouter.post(
  ['/purchases/:id/payment/withdraw', '/purchases/:id/payment-submissions/:subId/withdraw'],
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await withdrawPaymentSubmission(req.params.id, req.user!.id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
);

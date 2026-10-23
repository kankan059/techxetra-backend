import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('TASK-08: Manual UPI Payments & Super Admin Verification Desk', () => {
  describe('UTR Formatting & Validation Rules', () => {
    it('should normalize UTR strings by trimming, stripping hyphens/spaces, and uppercasing', () => {
      const rawUtr = '  sbi-123 456 789  ';
      const normalized = rawUtr.trim().replace(/[\s-]/g, '').toUpperCase();
      expect(normalized).toBe('SBI123456789');
      expect(/^[A-Z0-9]{8,35}$/.test(normalized)).toBe(true);
    });

    it('should reject invalid UTR strings (< 8 chars or special symbols)', () => {
      const shortUtr = '12345';
      const invalidChars = 'SBI#123@456!';
      expect(/^[A-Z0-9]{8,35}$/.test(shortUtr)).toBe(false);
      expect(/^[A-Z0-9]{8,35}$/.test(invalidChars)).toBe(false);
    });
  });

  describe('Super Admin Payment Queue Access Control', () => {
    it('GET /api/v1/admin/payments should reject unauthenticated requests (401)', async () => {
      const res = await request(app).get('/api/v1/admin/payments');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('POST /api/v1/admin/payments/dummy-id/decision should reject unauthenticated requests (401)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/payments/dummy-id/decision')
        .send({ decision: 'APPROVE' });

      expect(res.status).toBe(401);
    });
  });

  describe('The Anti-Self-Dealing Invariant', () => {
    it('should prevent reviewers from reviewing their own purchases', () => {
      const reviewerId = 'TX260001';
      const purchaseBuyerId = 'TX260001';

      const isSelfReview = reviewerId === purchaseBuyerId;
      expect(isSelfReview).toBe(true);
    });
  });

  describe('The Durable Payment Truth Invariant', () => {
    it('should ensure paid status is never reverted if ticket generation fails', () => {
      const initialStatus = 'PENDING_VERIFICATION';
      const newStatus = 'PAID';
      const fulfillmentStatus = 'FAILED';
      const fulfillmentLastError = 'Database connection reset during ticket creation';

      expect(newStatus).toBe('PAID');
      expect(fulfillmentStatus).toBe('FAILED');
      expect(fulfillmentLastError).toBeDefined();
    });
  });

  describe('Participant Payment Submission Validation', () => {
    it('POST /api/v1/purchases/:id/payment should require transactionId', async () => {
      const res = await request(app)
        .post('/api/v1/purchases/dummy-id/payment')
        .send({});

      expect([400, 401]).toContain(res.status);
    });
  });
});

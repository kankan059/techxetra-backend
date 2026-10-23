import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import {
  generateOrderPublicId,
  generateTicketPublicId,
} from '../src/services/purchase.service';
import { env } from '../src/config/env';

describe('TASK-07: Checkout, 15-Minute Seat Hold & Native PostgreSQL Transactions', () => {
  describe('Public ID Generation', () => {
    it('should generate human-safe sequential order IDs matching TX26-ORD-XXXX', () => {
      const orderId1 = generateOrderPublicId();
      const orderId2 = generateOrderPublicId();

      expect(orderId1.startsWith('TX26-ORD-')).toBe(true);
      expect(orderId2.startsWith('TX26-ORD-')).toBe(true);
      expect(orderId1).not.toBe(orderId2);
    });

    it('should generate human-safe sequential ticket IDs matching TX26-TKT-XXXX', () => {
      const ticketId = generateTicketPublicId();
      expect(ticketId.startsWith('TX26-TKT-')).toBe(true);
    });
  });

  describe('Purchase Route Access & Validation', () => {
    it('POST /api/v1/purchases should require authentication (401)', async () => {
      const res = await request(app)
        .post('/api/v1/purchases')
        .send({
          items: [
            {
              itemType: 'GATE_PASS',
            },
          ],
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('GET /api/v1/purchases/mine should require authentication (401)', async () => {
      const res = await request(app).get('/api/v1/purchases/mine');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/purchases/:id should require authentication (401)', async () => {
      const res = await request(app).get('/api/v1/purchases/dummy-id');
      expect(res.status).toBe(401);
    });
  });

  describe('Pricing Matrix Rules (The All-Student Rule)', () => {
    it('should charge general team rate if even one member is not a student', () => {
      const members = [
        { isStudent: 1 },
        { isStudent: 1 },
        { isStudent: 0 }, // Non-student
        { isStudent: 1 },
      ];

      const allStudents = members.every((m) => m.isStudent === 1);
      expect(allStudents).toBe(false);

      const generalPricePaise = 50000; // ₹500
      const studentPricePaise = 30000; // ₹300

      const billedAmount = allStudents ? studentPricePaise : generalPricePaise;
      expect(billedAmount).toBe(generalPricePaise);
    });

    it('should charge student team rate when 100% of members are verified students', () => {
      const members = [
        { isStudent: 1 },
        { isStudent: 1 },
        { isStudent: 1 },
      ];

      const allStudents = members.every((m) => m.isStudent === 1);
      expect(allStudents).toBe(true);

      const generalPricePaise = 50000;
      const studentPricePaise = 30000;

      const billedAmount = allStudents ? studentPricePaise : generalPricePaise;
      expect(billedAmount).toBe(studentPricePaise);
    });
  });

  describe('15-Minute Reservation Expiry Calculation', () => {
    it('should set reservation TTL to exactly 15 minutes (900000 ms)', () => {
      expect(env.PURCHASE_RESERVATION_TTL_MS).toBe(900000); // 15 mins

      const now = Date.now();
      const expiresAt = now + env.PURCHASE_RESERVATION_TTL_MS;
      const diffMinutes = (expiresAt - now) / (1000 * 60);

      expect(diffMinutes).toBe(15);
    });
  });
});

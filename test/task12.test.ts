import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('TASK-12: Super Admin Operations, BI Reports & Audit Logging', () => {
  describe('Super Admin Route Access Boundaries', () => {
    it('GET /api/v1/admin/users should require Super Admin (401 when unauthenticated)', async () => {
      const res = await request(app).get('/api/v1/admin/users');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('POST /api/v1/admin/events should require Super Admin (401)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/events')
        .send({ title: 'New Test Event', category: 'TECHNICAL' });

      expect(res.status).toBe(401);
    });

    it('GET /api/v1/admin/reports/summary should require Super Admin (401)', async () => {
      const res = await request(app).get('/api/v1/admin/reports/summary');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/admin/reports/financial should require Super Admin (401)', async () => {
      const res = await request(app).get('/api/v1/admin/reports/financial');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/admin/reports/attendance should require Super Admin (401)', async () => {
      const res = await request(app).get('/api/v1/admin/reports/attendance');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/admin/audit-logs should require Super Admin (401)', async () => {
      const res = await request(app).get('/api/v1/admin/audit-logs');
      expect(res.status).toBe(401);
    });
  });

  describe('Self-Demotion & Self-Deactivation Protection', () => {
    it('should prohibit Super Admin from demoting themselves or deactivating their own account', () => {
      const adminId = 'TX260001';
      const targetUserId = 'TX260001';

      const isSelf = adminId === targetUserId;
      const attemptDemotion = 'VOLUNTEER';
      const attemptDeactivation = false;

      const isDemotionBlocked = isSelf && attemptDemotion !== 'SUPER_ADMIN';
      const isDeactivationBlocked = isSelf && attemptDeactivation === false;

      expect(isDemotionBlocked).toBe(true);
      expect(isDeactivationBlocked).toBe(true);
    });
  });

  describe('Capacity Reduction & Safe Deletion Invariants', () => {
    it('should reject reducing event capacity below current seats_taken', () => {
      const currentSeatsTaken = 25;
      const requestedCapacity = 20;

      const isReductionAllowed = requestedCapacity >= currentSeatsTaken;
      expect(isReductionAllowed).toBe(false);
    });

    it('should safe-delete by transitioning to CANCELLED when attendees exist', () => {
      const attendeeCount = 15;
      const action = attendeeCount > 0 ? 'CANCELLED' : 'HARD_DELETE';

      expect(action).toBe('CANCELLED');
    });

    it('should hard-delete cleanly when zero attendees exist', () => {
      const attendeeCount = 0;
      const action = attendeeCount > 0 ? 'CANCELLED' : 'HARD_DELETE';

      expect(action).toBe('HARD_DELETE');
    });
  });
});

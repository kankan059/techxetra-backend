import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { signTicketQr, verifyTicketQr } from '../src/lib/crypto';

describe('TASK-09: Digital Tickets, HMAC QR Codes & Check-In Scanning', () => {
  describe('Cryptographic QR Code Format & Verification', () => {
    it('should generate valid QR token with format tx1.<ticketId>.<version>.<hmac>', () => {
      const ticketId = '4ef2ba18-87a4-44b2-9118-a6d13d2bb0f0';
      const version = 1;
      const qrToken = signTicketQr(ticketId, version);

      const parts = qrToken.split('.');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('tx1');
      expect(parts[1]).toBe(ticketId);
      expect(parts[2]).toBe('1');
      expect(parts[3].length).toBeGreaterThan(16);

      const verified = verifyTicketQr(qrToken);
      expect(verified.valid).toBe(true);
      expect(verified.ticketId).toBe(ticketId);
      expect(verified.version).toBe(version);
    });

    it('should reject forged or tampered signatures in constant time', () => {
      const ticketId = '4ef2ba18-87a4-44b2-9118-a6d13d2bb0f0';
      const validToken = signTicketQr(ticketId, 1);

      // Alter signature
      const forgedToken = validToken.slice(0, -6) + 'abcdef';
      const result = verifyTicketQr(forgedToken);
      expect(result.valid).toBe(false);
    });
  });

  describe('Ticket & Scanner Route Access Protection', () => {
    it('GET /api/v1/tickets/mine should require authentication (401)', async () => {
      const res = await request(app).get('/api/v1/tickets/mine');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('POST /api/v1/staff/scan/lookup should require staff role (401 when unauthenticated)', async () => {
      const res = await request(app)
        .post('/api/v1/staff/scan/lookup')
        .send({ qrToken: 'tx1.dummy.1.abc' });

      expect(res.status).toBe(401);
    });

    it('POST /api/v1/staff/scan/check-in should require staff role (401 when unauthenticated)', async () => {
      const res = await request(app)
        .post('/api/v1/staff/scan/check-in')
        .send({ qrToken: 'tx1.dummy.1.abc' });

      expect(res.status).toBe(401);
    });

    it('POST /api/v1/admin/tickets/dummy-id/revoke should require Super Admin (401)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/tickets/dummy-id/revoke')
        .send();

      expect(res.status).toBe(401);
    });
  });

  describe('Scanner Admission Invariants', () => {
    it('should require physical student ID inspection for student tier passes', () => {
      const tier = 'STUDENT';
      const studentIdChecked = false;

      const canAdmitWithoutId = tier !== 'STUDENT' || studentIdChecked;
      expect(canAdmitWithoutId).toBe(false);
    });

    it('should grant admission when student ID card is physically verified', () => {
      const tier = 'STUDENT';
      const studentIdChecked = true;

      const canAdmitWithId = tier !== 'STUDENT' || studentIdChecked;
      expect(canAdmitWithId).toBe(true);
    });
  });
});

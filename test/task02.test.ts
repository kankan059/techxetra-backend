import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  generateSessionToken,
  signTicketQr,
  verifyTicketQr,
} from '../src/lib/crypto';
import * as schema from '../src/db/schema';

describe('TASK-02: Cryptography & Database Schema Integrity', () => {
  describe('Password Hashing (PBKDF2-SHA512)', () => {
    it('should hash password with salt and verify correctly', () => {
      const password = 'SecretPassword123!';
      const hash = hashPassword(password);

      expect(hash).toContain(':');
      expect(verifyPassword(password, hash)).toBe(true);
      expect(verifyPassword('WrongPassword', hash)).toBe(false);
    });

    it('should generate different hashes for same password due to random salt', () => {
      const password = 'SamePassword';
      const hash1 = hashPassword(password);
      const hash2 = hashPassword(password);

      expect(hash1).not.toBe(hash2);
      expect(verifyPassword(password, hash1)).toBe(true);
      expect(verifyPassword(password, hash2)).toBe(true);
    });
  });

  describe('Session Token Hashing', () => {
    it('should generate 64-char hex session token and deterministic SHA-256 hash', () => {
      const rawToken = generateSessionToken();
      expect(rawToken).toHaveLength(64);

      const hash1 = hashToken(rawToken);
      const hash2 = hashToken(rawToken);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });
  });

  describe('HMAC QR Signatures & Verification', () => {
    it('should generate and verify valid QR token', () => {
      const ticketId = 'a555e347-160d-4074-9544-d8900662d5e7';
      const version = 1;
      const qrPayload = signTicketQr(ticketId, version);

      expect(qrPayload.startsWith(`tx1.${ticketId}.${version}.`)).toBe(true);

      const verification = verifyTicketQr(qrPayload);
      expect(verification.valid).toBe(true);
      expect(verification.ticketId).toBe(ticketId);
      expect(verification.version).toBe(version);
    });

    it('should reject tampered or invalid QR tokens', () => {
      const ticketId = 'a555e347-160d-4074-9544-d8900662d5e7';
      const version = 1;
      const qrPayload = signTicketQr(ticketId, version);

      // Tamper signature
      const tampered = qrPayload.slice(0, -4) + '0000';
      expect(verifyTicketQr(tampered).valid).toBe(false);

      // Tamper version
      const tamperedVersion = `tx1.${ticketId}.2.${qrPayload.split('.')[3]}`;
      expect(verifyTicketQr(tamperedVersion).valid).toBe(false);

      // Malformed format
      expect(verifyTicketQr('random-malformed-string').valid).toBe(false);
    });
  });

  describe('Schema Models & Constraints Definitions', () => {
    it('should export all required domain tables', () => {
      expect(schema.users).toBeDefined();
      expect(schema.sessions).toBeDefined();
      expect(schema.festDays).toBeDefined();
      expect(schema.settings).toBeDefined();
      expect(schema.events).toBeDefined();
      expect(schema.eventFormVersions).toBeDefined();
      expect(schema.eventStaff).toBeDefined();
      expect(schema.gateStaff).toBeDefined();
      expect(schema.teams).toBeDefined();
      expect(schema.teamMembers).toBeDefined();
      expect(schema.purchases).toBeDefined();
      expect(schema.purchaseItems).toBeDefined();
      expect(schema.registrations).toBeDefined();
      expect(schema.payments).toBeDefined();
      expect(schema.paymentAuditLogs).toBeDefined();
      expect(schema.tickets).toBeDefined();
      expect(schema.checkInLogs).toBeDefined();
      expect(schema.esportsMatches).toBeDefined();
      expect(schema.esportsScores).toBeDefined();
      expect(schema.esportsScoreHistory).toBeDefined();
      expect(schema.auditLogs).toBeDefined();
      expect(schema.idempotencyKeys).toBeDefined();
    });

    it('should have correct enum values matching system requirements', () => {
      expect(schema.userRoleEnum.enumValues).toContain('SUPER_ADMIN');
      expect(schema.userRoleEnum.enumValues).toContain('PARTICIPANT');
      expect(schema.eventCategoryEnum.enumValues).toContain('E_SPORTS');
      expect(schema.purchaseStatusEnum.enumValues).toContain('AWAITING_PAYMENT');
      expect(schema.purchaseStatusEnum.enumValues).toContain('PAID');
      expect(schema.purchaseStatusEnum.enumValues).toContain('FULFILLMENT_FAILED');
      expect(schema.paymentStatusEnum.enumValues).toContain('SUBMITTED');
      expect(schema.paymentStatusEnum.enumValues).toContain('APPROVED');
      expect(schema.paymentStatusEnum.enumValues).toContain('REJECTED');
    });
  });
});

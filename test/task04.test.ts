import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { checkProfileCompleteness, toUserDto } from '../src/services/user.service';
import { getSessionTtl } from '../src/services/session.service';
import { env } from '../src/config/env';

describe('TASK-04: Authentication, Sessions & User Profiles', () => {
  describe('Profile Completeness Rules', () => {
    it('should flag incomplete profile when required fields are missing', () => {
      const incompleteUser = {
        name: 'A', // too short
        phone: '12345', // invalid
        isStudent: 1,
        institutionName: null,
        institutionId: null,
      };

      const result = checkProfileCompleteness(incompleteUser as any);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('name');
      expect(result.missingFields).toContain('phone');
      expect(result.missingFields).toContain('institution_name');
      expect(result.missingFields).toContain('institution_id');
    });

    it('should pass completeness when all criteria are satisfied', () => {
      const completeUser = {
        name: 'Rahul Sharma',
        phone: '9876543210',
        isStudent: 1,
        institutionName: 'Tezpur University',
        institutionId: 'CS26001',
      };

      const result = checkProfileCompleteness(completeUser as any);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toHaveLength(0);
    });

    it('should not require institution details for non-students', () => {
      const nonStudent = {
        name: 'Rahul Sharma',
        phone: '9876543210',
        isStudent: 0,
      };

      const result = checkProfileCompleteness(nonStudent as any);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toHaveLength(0);
    });
  });

  describe('User DTO Sanitization', () => {
    it('should exclude password_hash and include calculated profile fields', () => {
      const rawUser = {
        id: 'TX260002',
        googleSub: null,
        email: 'rahul@example.com',
        passwordHash: 'salt:hash_secret',
        name: 'Rahul Sharma',
        avatarUrl: null,
        phone: '9876543210',
        isStudent: 0,
        institutionName: null,
        institutionId: null,
        studentFieldsLocked: 0,
        role: 'PARTICIPANT' as const,
        canReviewPayments: 0,
        isActive: 1,
        emailVerifiedAt: null,
        profileCompletedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const dto: any = toUserDto(rawUser);
      expect(dto.id).toBe('TX260002');
      expect(dto.passwordHash).toBeUndefined();
      expect(dto.password_hash).toBeUndefined();
      expect(dto.profileComplete).toBe(true);
      expect(dto.missingFields).toEqual([]);
    });
  });

  describe('Session TTL Architecture', () => {
    it('should allocate 30 days TTL for PARTICIPANT and 12 hours for STAFF/ADMIN', () => {
      expect(getSessionTtl('PARTICIPANT')).toBe(env.PARTICIPANT_SESSION_TTL_MS); // 30 days
      expect(getSessionTtl('SUPER_ADMIN')).toBe(env.STAFF_SESSION_TTL_MS); // 12 hours
      expect(getSessionTtl('EVENT_LEAD')).toBe(env.STAFF_SESSION_TTL_MS); // 12 hours
      expect(getSessionTtl('VOLUNTEER')).toBe(env.STAFF_SESSION_TTL_MS); // 12 hours
    });
  });

  describe('Auth Route Input Validations', () => {
    it('POST /api/v1/auth/register should reject short passwords (< 8 chars)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/register should reject invalid emails', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid-email',
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/auth/login should reject empty credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'notanemail',
          password: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/v1/auth/session should return unauthenticated when no session cookie exists', async () => {
      const res = await request(app).get('/api/v1/auth/session');
      expect(res.status).toBe(200);
      expect(res.body.data.authenticated).toBe(false);
      expect(res.body.data.user).toBeNull();
    });

    it('GET /api/v1/me should require authentication (401)', async () => {
      const res = await request(app).get('/api/v1/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });
});

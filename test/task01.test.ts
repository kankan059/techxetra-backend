import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { envSchema } from '../src/config/env';

describe('TASK-01: Foundation & Project Setup', () => {
  it('should validate environment schema and catch missing fields', () => {
    // Missing required DATABASE_URL
    const invalidEnv = {
      NODE_ENV: 'development',
    };
    const result = envSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('DATABASE_URL'))).toBe(true);
    }
  });

  it('should pass validation with valid environment variables', () => {
    const validEnv = {
      DATABASE_URL: 'postgresql://techxetra:password@localhost:5432/techxetra_db',
    };
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(4000); // Default applied
      expect(result.data.NODE_ENV).toBe('development');
    }
  });

  it('GET /health should return 200 with standard response structure and request ID', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data.status).toBe('ok');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toHaveProperty('requestId');
    expect(res.headers).toHaveProperty('x-request-id');
  });
});

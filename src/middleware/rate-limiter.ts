import { Request, Response, NextFunction } from 'express';
import { sendError } from '../common/response';
import { env } from '../config/env';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; message?: string }) {
  const store = new Map<string, RateLimitRecord>();

  // Periodically clean up expired entries
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetAt) {
        store.delete(key);
      }
    }
  }, 60000);
  cleanupTimer.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // In test environment, skip rate limiting unless specifically testing rate limits
    if (env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip ||
      '127.0.0.1';
    const key = `${req.baseUrl || ''}${req.path}:${ip}`;
    const now = Date.now();

    const record = store.get(key);

    if (!record || now > record.resetAt) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    record.count++;

    if (record.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      sendError(
        res,
        'RATE_LIMIT_EXCEEDED',
        options.message || 'Too many requests. Please slow down and try again later.',
        429
      );
      return;
    }

    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per 15 minutes per IP
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

export const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: 'Administrative request limit reached. Please wait a moment.',
});

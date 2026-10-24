import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { sendError } from '../common/response';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe read-only HTTP methods do not require origin check
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // In test environment, skip CSRF origin check unless explicitly enabled for testing
  if (env.NODE_ENV === 'test' && !req.headers['x-test-csrf']) {
    return next();
  }

  const hasCookieAuth = Boolean(
    req.cookies &&
      (req.cookies['session'] ||
        req.cookies['__Host-session'] ||
        (req.headers.cookie && req.headers.cookie.includes('session')))
  );

  let origin: string | null = null;
  if (req.headers['origin']) {
    origin = req.headers['origin'] as string;
  } else if (req.headers['referer']) {
    try {
      origin = new URL(req.headers['referer'] as string).origin;
    } catch {
      origin = null;
    }
  }

  // Enforce complete CSRF strategy: for cookie-authenticated state changes,
  // missing both Origin and Referer must be rejected
  if (hasCookieAuth && !origin) {
    sendError(
      res,
      'CSRF_MISSING_ORIGIN',
      'Origin or Referer header is required for cookie-authenticated mutations',
      403
    );
    return;
  }

  // If an Origin or Referer header was provided, validate only if a specific origin is enforced
  if (origin && env.FRONTEND_ORIGIN && env.FRONTEND_ORIGIN !== '*' && env.FRONTEND_ORIGIN !== 'all') {
    try {
      const allowedOrigin = new URL(env.FRONTEND_ORIGIN).origin;
      if (origin !== allowedOrigin) {
        sendError(res, 'CSRF_ORIGIN_INVALID', 'Cross-origin request rejected', 403);
        return;
      }
    } catch {
      // If FRONTEND_ORIGIN is not a single valid URL, allow cross-origin
    }
  }

  next();
}

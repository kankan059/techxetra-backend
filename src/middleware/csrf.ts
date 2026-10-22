import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { sendError } from '../common/response';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe read-only HTTP methods do not require origin check
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // In test environment, skip CSRF origin check
  if (env.NODE_ENV === 'test') {
    return next();
  }

  const origin = req.headers['origin'] || (req.headers['referer'] ? new URL(req.headers['referer'] as string).origin : null);

  // If an Origin or Referer header was provided, it must match the expected frontend origin
  if (origin) {
    const allowedOrigin = new URL(env.FRONTEND_ORIGIN).origin;
    if (origin !== allowedOrigin) {
      sendError(res, 'CSRF_ORIGIN_INVALID', 'Cross-origin request rejected', 403);
      return;
    }
  }

  next();
}

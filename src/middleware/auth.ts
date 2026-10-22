import { Request, Response, NextFunction } from 'express';
import { AppError } from '../common/errors';
import { getSessionTokenFromRequest, validateSession } from '../services/session.service';
import { checkProfileCompleteness } from '../services/user.service';

/**
 * Middleware that requires a valid, active user session.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = getSessionTokenFromRequest(req);
    if (!rawToken) {
      throw AppError.unauthorized('Authentication required', 'UNAUTHENTICATED');
    }

    const authContext = await validateSession(rawToken);
    if (!authContext) {
      throw AppError.unauthorized('Invalid, expired, or revoked session', 'UNAUTHENTICATED');
    }

    req.user = authContext.user;
    req.session = authContext.session;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware that optionally attaches the user if an active session exists.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawToken = getSessionTokenFromRequest(req);
    if (rawToken) {
      const authContext = await validateSession(rawToken);
      if (authContext) {
        req.user = authContext.user;
        req.session = authContext.session;
      }
    }
    next();
  } catch {
    next();
  }
}

/**
 * Middleware that restricts access to specific user roles.
 */
export function requireRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
    }

    // Treat 'LEAD' and 'EVENT_LEAD' interchangeably
    const userRole = req.user.role === 'LEAD' ? 'EVENT_LEAD' : req.user.role;
    const normalizedRoles = allowedRoles.map((r) => (r === 'LEAD' ? 'EVENT_LEAD' : r));

    if (!normalizedRoles.includes(userRole)) {
      return next(
        AppError.forbidden('You do not have the required permissions to access this resource', 'FORBIDDEN')
      );
    }

    next();
  };
}

/**
 * Middleware that strictly restricts access to SUPER_ADMIN only.
 */
export function requireSuperAdminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    return next(
      AppError.forbidden('Only Super Administrators can perform this action', 'SUPER_ADMIN_REQUIRED')
    );
  }

  next();
}

/**
 * Middleware that requires the user profile to be complete before proceeding (e.g. at checkout).
 */
export function requireProfileComplete(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
  }

  const { isComplete, missingFields } = checkProfileCompleteness(req.user);
  if (!isComplete) {
    return next(
      AppError.badRequest('Please complete your profile before proceeding', 'PROFILE_INCOMPLETE', {
        missingFields,
      })
    );
  }

  next();
}

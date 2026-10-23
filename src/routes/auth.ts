import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { AppError } from '../common/errors';
import { sendSuccess } from '../common/response';
import { hashPassword, verifyPassword } from '../lib/crypto';
import {
  generateNextUserId,
  linkPendingTeamInvitations,
  toUserDto,
} from '../services/user.service';
import {
  createSession,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionTokenFromRequest,
} from '../services/session.service';
import { verifyGoogleIdToken, resolveGoogleUser } from '../services/google-auth.service';
import { validate } from '../middleware/validate';
import { optionalAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rate-limiter';

export const authRouter = Router();

const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    name: z.string().min(2, 'Name must be at least 2 characters long').optional(),
    displayName: z.string().min(2).optional(),
  })
  .strict();

const loginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

const googleSchema = z
  .object({
    idToken: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
  })
  .strict();

// 1. POST /auth/register
authRouter.post(
  '/auth/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const password = req.body.password;
      const name = (req.body.name || req.body.displayName || 'Festival Participant').trim();

      // Check if normalized email is already registered
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        // Prevent claiming pre-registered or Google-linked accounts
        throw AppError.conflict('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
      }

      const nextId = await generateNextUserId();
      const passwordHash = hashPassword(password);
      const now = Date.now();

      const [newUser] = await db
        .insert(users)
        .values({
          id: nextId,
          email,
          passwordHash,
          name,
          role: 'PARTICIPANT',
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Link any existing team invitations for this email
      await linkPendingTeamInvitations(newUser.id, newUser.email);

      // Create session and set cookie
      const { rawToken } = await createSession(newUser.id, newUser.role, req.ip, req.headers['user-agent']);
      setSessionCookie(res, rawToken, newUser.role);

      sendSuccess(res, { user: toUserDto(newUser) }, 201);
    } catch (err) {
      next(err);
    }
  }
);

// 2. POST /auth/login
authRouter.post(
  '/auth/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const email = req.body.email.trim().toLowerCase();
      const password = req.body.password;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      // Uniform error message to prevent user enumeration
      if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
      }

      if (user.isActive === 0) {
        throw AppError.forbidden('Your account has been deactivated', 'ACCOUNT_DISABLED');
      }

      const { rawToken } = await createSession(user.id, user.role, req.ip, req.headers['user-agent']);
      setSessionCookie(res, rawToken, user.role);

      sendSuccess(res, { user: toUserDto(user) }, 200);
    } catch (err) {
      next(err);
    }
  }
);

// 3. POST /auth/google
authRouter.post(
  '/auth/google',
  authRateLimiter,
  validate({ body: googleSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.body.idToken || req.body.id_token;
      if (!token) {
        throw AppError.badRequest('idToken is required');
      }

      const googlePayload = await verifyGoogleIdToken(token);
      const user = await resolveGoogleUser(googlePayload);

      const { rawToken } = await createSession(user.id, user.role, req.ip, req.headers['user-agent']);
      setSessionCookie(res, rawToken, user.role);

      sendSuccess(res, { user: toUserDto(user) }, 200);
    } catch (err) {
      next(err);
    }
  }
);

// 4. POST /auth/logout
authRouter.post('/auth/logout', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawToken = getSessionTokenFromRequest(req);
    if (rawToken) {
      await revokeSession(rawToken);
    }
    clearSessionCookie(res);
    sendSuccess(res, { message: 'Logged out successfully' }, 200);
  } catch (err) {
    next(err);
  }
});

// 5. GET /auth/session
authRouter.get(
  '/auth/session',
  optionalAuth,
  (req: Request, res: Response): void => {
    if (req.user) {
      sendSuccess(res, {
        authenticated: true,
        user: toUserDto(req.user),
      });
    } else {
      sendSuccess(res, {
        authenticated: false,
        user: null,
      });
    }
  }
);

import { Request, Response } from 'express';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import { env } from '../config/env';
import { generateSessionToken, hashToken } from '../lib/crypto';
import type { SessionSelect, UserSelect } from '../types/express';

export const COOKIE_NAME = env.NODE_ENV === 'production' ? '__Host-session' : 'session';

export function getSessionTtl(role: string): number {
  if (role === 'PARTICIPANT') {
    return env.PARTICIPANT_SESSION_TTL_MS; // 30 days
  }
  return env.STAFF_SESSION_TTL_MS; // 12 hours for staff/admin
}

export async function createSession(
  userId: string,
  role: 'PARTICIPANT' | 'VOLUNTEER' | 'EVENT_LEAD' | 'LEAD' | 'SUPER_ADMIN',
  ipHash?: string,
  userAgent?: string
): Promise<{ rawToken: string; session: SessionSelect }> {
  const rawToken = generateSessionToken();
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const ttl = getSessionTtl(role);
  const expiresAt = now + ttl;

  const [session] = await db
    .insert(sessions)
    .values({
      id: tokenHash,
      userId,
      role,
      expiresAt,
      ipHash,
      userAgent,
      lastSeenAt: now,
      createdAt: now,
    })
    .returning();

  return { rawToken, session };
}

export async function validateSession(
  rawToken: string
): Promise<{ user: UserSelect; session: SessionSelect } | null> {
  const tokenHash = hashToken(rawToken);
  const now = Date.now();

  const [record] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        eq(users.isActive, 1)
      )
    )
    .limit(1);

  if (!record) {
    return null;
  }

  const { session, user } = record;

  // Sliding session logic for PARTICIPANT:
  // If remaining time is less than half TTL (< 15 days), extend by 30 days
  if (user.role === 'PARTICIPANT') {
    const remainingTime = session.expiresAt - now;
    const halfTtl = env.PARTICIPANT_SESSION_TTL_MS / 2;

    if (remainingTime < halfTtl) {
      const newExpiresAt = now + env.PARTICIPANT_SESSION_TTL_MS;
      await db
        .update(sessions)
        .set({
          expiresAt: newExpiresAt,
          lastSeenAt: now,
        })
        .where(eq(sessions.id, tokenHash));
      session.expiresAt = newExpiresAt;
    } else {
      await db
        .update(sessions)
        .set({ lastSeenAt: now })
        .where(eq(sessions.id, tokenHash));
    }
  } else {
    // Staff sessions have fixed TTL (no extension), just update lastSeenAt
    await db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, tokenHash));
  }

  return { user, session };
}

export async function revokeSession(rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const res = await db
    .update(sessions)
    .set({ revokedAt: Date.now() })
    .where(eq(sessions.id, tokenHash));
  return (res.rowCount ?? 0) > 0;
}

export function setSessionCookie(res: Response, rawToken: string, role: string): void {
  const ttl = getSessionTtl(role);
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    maxAge: ttl,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  });
}

export function getSessionTokenFromRequest(req: Request): string | null {
  // 1. From Cookie
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  // Fallback to legacy cookie name if different
  if (req.cookies && req.cookies['session']) {
    return req.cookies['session'];
  }
  // 2. From Authorization Bearer header (for API / script consumers)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

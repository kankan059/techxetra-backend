import * as jose from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { env } from '../config/env';
import { AppError } from '../common/errors';
import { generateNextUserId, linkPendingTeamInvitations } from './user.service';
import type { UserSelect } from '../types/express';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const googleJwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export interface GooglePayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean;
}

/**
 * Verifies a Google ID Token using jose against Google's public JWKS.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GooglePayload> {
  // Allow mocked test verification in test mode
  if (env.NODE_ENV === 'test' && idToken.startsWith('mock_test_token_')) {
    const sub = idToken.replace('mock_test_token_', '');
    return {
      sub,
      email: `${sub}@example.com`,
      name: `Test User ${sub}`,
      email_verified: true,
    };
  }

  try {
    const { payload } = await jose.jwtVerify(idToken, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
    });

    if (!payload.sub || !payload.email) {
      throw AppError.unauthorized('Google ID token missing subject or email', 'INVALID_GOOGLE_TOKEN');
    }

    return {
      sub: payload.sub,
      email: String(payload.email).toLowerCase().trim(),
      name: payload.name ? String(payload.name) : undefined,
      picture: payload.picture ? String(payload.picture) : undefined,
      email_verified: Boolean(payload.email_verified),
    };
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    throw AppError.unauthorized('Failed to verify Google ID token', 'INVALID_GOOGLE_TOKEN');
  }
}

/**
 * Resolves an authenticated Google user into our database.
 */
export async function resolveGoogleUser(googlePayload: GooglePayload): Promise<UserSelect> {
  const { sub, email, name, picture, email_verified } = googlePayload;

  if (!email_verified) {
    throw AppError.unauthorized(
      'Google email address is not verified. Please verify your email with Google first.',
      'EMAIL_NOT_VERIFIED'
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const now = Date.now();

  // 1. Check if user already exists by google_sub
  const [userBySub] = await db
    .select()
    .from(users)
    .where(eq(users.googleSub, sub))
    .limit(1);

  if (userBySub) {
    if (userBySub.isActive === 0) {
      throw AppError.forbidden('Your account has been deactivated.', 'ACCOUNT_DISABLED');
    }
    return userBySub;
  }

  // 2. Check if user already exists by email
  const [userByEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (userByEmail) {
    if (userByEmail.isActive === 0) {
      throw AppError.forbidden('Your account has been deactivated.', 'ACCOUNT_DISABLED');
    }

    // If existing account already has a different Google subject linked
    if (userByEmail.googleSub && userByEmail.googleSub !== sub) {
      throw AppError.conflict(
        'This email address is already linked to a different Google account.',
        'GOOGLE_ACCOUNT_CONFLICT'
      );
    }

    // Link google_sub atomically
    const [updatedUser] = await db
      .update(users)
      .set({
        googleSub: sub,
        avatarUrl: userByEmail.avatarUrl || picture,
        emailVerifiedAt: userByEmail.emailVerifiedAt || now,
        updatedAt: now,
      })
      .where(eq(users.id, userByEmail.id))
      .returning();

    return updatedUser;
  }

  // 3. Register new user with sequential TX26 ID
  const newUserId = await generateNextUserId();
  const [newUser] = await db
    .insert(users)
    .values({
      id: newUserId,
      googleSub: sub,
      email: normalizedEmail,
      name: name || 'Festival Participant',
      avatarUrl: picture,
      role: 'PARTICIPANT',
      isActive: 1,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // Link any pending team invites
  await linkPendingTeamInvitations(newUser.id, newUser.email);

  return newUser;
}

import { sql } from 'drizzle-orm';
import { db } from '../db';
import { users, teamMembers } from '../db/schema';
import type { UserSelect } from '../types/express';

/**
 * Atomically generates the next sequential user ID in the format TX26XXXX.
 * Utilizes a PostgreSQL sequence with a synchronization fallback.
 */
export async function generateNextUserId(): Promise<string> {
  // Ensure the PostgreSQL sequence exists
  await db.execute(sql`
    CREATE SEQUENCE IF NOT EXISTS user_id_seq START WITH 1 INCREMENT BY 1;
  `);

  // Query nextval
  const result = await db.execute<{ nextval: string }>(sql`
    SELECT nextval('user_id_seq') AS nextval;
  `);

  let nextNum = 1;
  if (result.rows.length > 0 && result.rows[0].nextval) {
    nextNum = parseInt(String(result.rows[0].nextval), 10);
  }

  // Fallback check against existing max ID in database
  const maxResult = await db.execute<{ id: string }>(sql`
    SELECT id FROM users WHERE id LIKE 'TX26%' ORDER BY id DESC LIMIT 1
  `);

  if (maxResult.rows.length > 0 && maxResult.rows[0].id) {
    const existingNum = parseInt(maxResult.rows[0].id.replace(/^TX26/, ''), 10);
    if (!isNaN(existingNum) && nextNum <= existingNum) {
      nextNum = existingNum + 1;
      // Resynchronize sequence
      await db.execute(sql`
        SELECT setval('user_id_seq', ${nextNum});
      `);
    }
  }

  return `TX26${String(nextNum).padStart(4, '0')}`;
}

/**
 * Links any pending team invitations that were issued to the user's email address.
 */
export async function linkPendingTeamInvitations(userId: string, email: string): Promise<number> {
  const normalizedEmail = email.trim().toLowerCase();
  const res = await db.execute(sql`
    UPDATE team_members
    SET user_id = ${userId}
    WHERE lower(invited_email) = ${normalizedEmail} AND user_id IS NULL
  `);
  return res.rowCount || 0;
}

export interface ProfileCompleteness {
  isComplete: boolean;
  missingFields: string[];
}

/**
 * Checks if the user profile satisfies completeness criteria:
 * 1. name >= 2 chars
 * 2. phone is 10 digits
 * 3. if isStudent is 1, institutionName and institutionId must be provided
 */
export function checkProfileCompleteness(user: Partial<UserSelect>): ProfileCompleteness {
  const missingFields: string[] = [];

  if (!user.name || user.name.trim().length < 2) {
    missingFields.push('name');
  }

  const phoneRegex = /^[6-9]\d{9}$/;
  if (!user.phone || !phoneRegex.test(user.phone.trim())) {
    missingFields.push('phone');
  }

  if (user.isStudent === 1) {
    if (!user.institutionName || user.institutionName.trim().length < 2) {
      missingFields.push('institution_name');
    }
    if (!user.institutionId || user.institutionId.trim().length < 1) {
      missingFields.push('institution_id');
    }
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Sanitizes and formats a User object for client responses, stripping sensitive hashes.
 */
export function toUserDto(user: UserSelect) {
  const completeness = checkProfileCompleteness(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    displayName: user.name,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    isStudent: Boolean(user.isStudent),
    institutionName: user.institutionName,
    institutionId: user.institutionId,
    studentFieldsLocked: Boolean(user.studentFieldsLocked),
    role: user.role,
    isActive: Boolean(user.isActive),
    profileCompletedAt: user.profileCompletedAt,
    profileComplete: completeness.isComplete,
    missingFields: completeness.missingFields,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

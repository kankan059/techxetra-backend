import { eq, and, ne } from 'drizzle-orm';
import { db, pool } from './index';
import { users } from './schema';
import { hashPassword } from '../lib/crypto';

/**
 * Shows the current TX260001 admin row, then resets its email + password
 * from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in your .env.
 *
 * Usage (from backend root):
 *   npx tsx src/db/reset-admin.ts            # inspect + reset
 *   npx tsx src/db/reset-admin.ts --dry-run  # inspect only
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const adminId = 'TX260001';

  const [current] = await db.select().from(users).where(eq(users.id, adminId)).limit(1);

  if (!current) {
    console.log(`No user with id ${adminId} exists in this database.`);
    console.log('Check DATABASE_URL points at the DB you seeded, then run: npm run db:seed');
    return;
  }

  console.log('Current admin row:');
  console.log({
    id: current.id,
    email: current.email,
    role: current.role,
    isActive: current.isActive,
    hasPasswordHash: Boolean(current.passwordHash),
  });

  if (dryRun) return;

  const email = (process.env.SUPER_ADMIN_EMAIL || 'admin@techxetra.in').toLowerCase().trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error('SUPER_ADMIN_PASSWORD must be set in .env and be at least 10 characters');
  }

  // Make sure another account doesn't already own this email
  const [clash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, adminId)))
    .limit(1);
  if (clash) {
    throw new Error(`Email ${email} is already used by user ${clash.id}; pick another SUPER_ADMIN_EMAIL`);
  }

  await db
    .update(users)
    .set({
      email,
      passwordHash: hashPassword(password),
      role: 'SUPER_ADMIN',
      isActive: 1,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, adminId));

  console.log(`Reset done. Login with email "${email}" and the SUPER_ADMIN_PASSWORD from .env.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('Failed:', err.message || err);
    await pool.end();
    process.exit(1);
  });

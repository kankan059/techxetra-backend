import { db, pool } from './index';
import { festDays, settings, users } from './schema';
import { hashPassword } from '../lib/crypto';
import { sql } from 'drizzle-orm';

export async function seed() {
  console.log('🌱 Starting database seeding...');

  // 1. Seed Fest Days
  console.log('Seeding Fest Days (1, 2, 3)...');
  const days = [
    {
      dayNumber: 1,
      date: '2026-11-06',
      validFrom: Date.parse('2026-11-06T00:00:00Z'),
      validTo: Date.parse('2026-11-06T23:59:59Z'),
      description: 'Day 1 - Inception & Technical Events',
    },
    {
      dayNumber: 2,
      date: '2026-11-07',
      validFrom: Date.parse('2026-11-07T00:00:00Z'),
      validTo: Date.parse('2026-11-07T23:59:59Z'),
      description: 'Day 2 - Competitions & Workshops',
    },
    {
      dayNumber: 3,
      date: '2026-11-08',
      validFrom: Date.parse('2026-11-08T00:00:00Z'),
      validTo: Date.parse('2026-11-08T23:59:59Z'),
      description: 'Day 3 - Grand Finale & Cultural Night',
    },
  ];

  for (const day of days) {
    await db
      .insert(festDays)
      .values(day)
      .onConflictDoUpdate({
        target: festDays.dayNumber,
        set: {
          date: day.date,
          validFrom: day.validFrom,
          validTo: day.validTo,
          description: day.description,
        },
      });
  }

  // 2. Seed Default Settings
  console.log('Seeding Festival Settings...');
  const defaultSettings = [
    { key: 'purchases_enabled', value: true },
    { key: 'gate_pass_price_paise', value: 30000 },
    { key: 'gate_pass_student_price_paise', value: 15000 },
    { key: 'support_email', value: 'support@techxetra.in' },
  ];

  const now = Date.now();
  for (const setting of defaultSettings) {
    await db
      .insert(settings)
      .values({
        key: setting.key,
        value: setting.value,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: setting.value,
          updatedAt: now,
        },
      });
  }

  // 3. Seed Default Super Admin Account
  console.log('Seeding Default Super Admin Account (TX260001)...');
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@techxetra.in';
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Admin@TechXetra2026';
  const adminPasswordHash = hashPassword(adminPassword);

  await db
    .insert(users)
    .values({
      id: 'TX260001',
      email: adminEmail.toLowerCase().trim(),
      name: 'System Administrator',
      passwordHash: adminPasswordHash,
      role: 'SUPER_ADMIN',
      isStudent: 0,
      studentFieldsLocked: 1,
      canReviewPayments: 1,
      isActive: 1,
      profileCompletedAt: now,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        role: 'SUPER_ADMIN',
        isActive: 1,
        canReviewPayments: 1,
        updatedAt: now,
      },
    });

  // 4. Setup Append-Only Database Triggers for Audit Tables
  console.log('Setting up append-only triggers for audit and history tables...');
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION prevent_update_or_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Table % is append-only; UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'audit_logs_prevent_mutation'
      ) THEN
        CREATE TRIGGER audit_logs_prevent_mutation
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'payment_audit_logs_prevent_mutation'
      ) THEN
        CREATE TRIGGER payment_audit_logs_prevent_mutation
        BEFORE UPDATE OR DELETE ON payment_audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'esports_score_history_prevent_mutation'
      ) THEN
        CREATE TRIGGER esports_score_history_prevent_mutation
        BEFORE UPDATE OR DELETE ON esports_score_history
        FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();
      END IF;
    END;
    $$;
  `);

  console.log('✅ Seeding completed successfully!');
}

// Allow direct execution
if (require.main === module) {
  seed()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Seeding failed:', err);
      await pool.end();
      process.exit(1);
    });
}

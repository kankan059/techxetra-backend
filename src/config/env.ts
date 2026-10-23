import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const requiredSecret = (name: string) =>
  z.string()
    .min(32, `${name} must be at least 32 characters`)
    .refine(
      (value) => !/placeholder|change.?me|example|testing|dummy|techxetra_secure|techxetra_session/i.test(value),
      `${name} must not be a placeholder`
    );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(5),
  DATABASE_POOL_MAX: z.coerce.number().default(20),

  GOOGLE_CLIENT_ID: isProduction
    ? z.string().min(1).refine(
      (value) => !/dummy|placeholder|example/i.test(value),
      'GOOGLE_CLIENT_ID must be configured for production'
    )
    : z.string().min(1).default('dummy-google-client-id'),

  FRONTEND_ORIGIN: isProduction
    ? z.string().url()
    : z.string().min(1).default('http://localhost:3000'),

  TICKET_HMAC_SECRET: isProduction
    ? requiredSecret('TICKET_HMAC_SECRET')
    : z.string().min(32).default(
      'techxetra_secure_hmac_secret_at_least_32_characters_long'
    ),

  SESSION_SECRET: isProduction
    ? requiredSecret('SESSION_SECRET')
    : z.string().min(32).default(
      'techxetra_session_secret_for_cookies_or_csrf_32_chars'
    ),

  UPI_VPA: z.string().min(3).default('techxetra@upi'),
  UPI_PAYEE_NAME: z.string().min(2).default('TechXetra Festival'),

  PURCHASE_RESERVATION_TTL_MS: z.coerce.number().default(900000),
  PARTICIPANT_SESSION_TTL_MS: z.coerce.number().default(2592000000),
  STAFF_SESSION_TTL_MS: z.coerce.number().default(43200000),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
});

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid or missing environment variables:');
  console.error(JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Hashes a plaintext password using PBKDF2-SHA512 with a unique salt.
 * Returns format: "salt:hash"
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a password against a stored "salt:hash" using constant-time comparison.
 */
export function verifyPassword(password: string, storedPasswordHash: string): boolean {
  try {
    const [salt, originalHash] = storedPasswordHash.split(':');
    if (!salt || !originalHash) return false;
    const computedHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computedHash, 'hex'), Buffer.from(originalHash, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Hashes a session token with SHA-256 for secure database storage.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generates a cryptographically secure 32-byte session token hex string.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Signs a ticket QR payload using HMAC-SHA256: tx1.<ticketId>.<version>.<signature>
 */
export function signTicketQr(ticketId: string, version: number): string {
  const payload = `tx1.${ticketId}.${version}`;
  const hmac = crypto
    .createHmac('sha256', env.TICKET_HMAC_SECRET)
    .update(payload)
    .digest('hex');
  return `${payload}.${hmac}`;
}

/**
 * Verifies and parses a signed ticket QR token.
 */
export function verifyTicketQr(qrPayload: string): { valid: boolean; ticketId?: string; version?: number } {
  try {
    const parts = qrPayload.split('.');
    if (parts.length !== 4 || parts[0] !== 'tx1') {
      return { valid: false };
    }

    const [, ticketId, versionStr, signature] = parts;
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      return { valid: false };
    }

    const expectedPayload = `tx1.${ticketId}.${version}`;
    const expectedSignature = crypto
      .createHmac('sha256', env.TICKET_HMAC_SECRET)
      .update(expectedPayload)
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    if (!isValid) return { valid: false };

    return { valid: true, ticketId, version };
  } catch {
    return { valid: false };
  }
}

# TASK 04: Authentication, Sliding Sessions & Profile Management

## Objective

Implement native email/password authentication, Google OAuth (JWKS
verification), sequential user ID generation (`TX26XXXX`), session
management with sliding TTLs in HttpOnly cookies, profile completeness
checking, and student discount field locking.

------------------------------------------------------------------------

## 1. Sequential User ID Generation (`src/services/user.service.ts`)

Every user (whether registering via email/password, Google OAuth, or
staff pre-registration) must be assigned a sequential ID in the format
`TX26XXXX` (e.g., `TX260001`, `TX260002`):

``` ts
import { sql } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../db/schema'

export async function generateNextUserId(tx = db): Promise<string> {
  // Query highest existing TX26 ID with table/row lock to prevent race conditions
  const result = await tx.execute(
    sql`SELECT id FROM users WHERE id LIKE 'TX26%' ORDER BY id DESC LIMIT 1 FOR UPDATE`
  )
  
  let nextNum = 1
  if (result.rows.length > 0 && typeof result.rows[0].id === 'string') {
    const numPart = result.rows[0].id.slice(4)
    const parsed = parseInt(numPart, 10)
    if (!isNaN(parsed) && parsed >= 1) {
      nextNum = parsed + 1
    }
  }

  return `TX26${String(nextNum).padStart(4, '0')}`
}
```

------------------------------------------------------------------------

## 2. Password Cryptography (`src/services/password.service.ts`)

-   **Algorithm:** PBKDF2 with SHA-256, 100,000 iterations, 16-byte
    cryptographically secure random salt.
-   **Storage Format:** `pbkdf2:sha256:100000:<salt_hex>:<hash_hex>`.
-   **Verification:** Use `crypto.timingSafeEqual` to verify the
    computed hash in constant time, preventing timing side-channel
    attacks.

------------------------------------------------------------------------

## 3. Google OAuth Verification (`src/services/google-auth.service.ts`)

-   Use `jose` to verify the incoming `id_token` against Google's
    official JWKS (`https://www.googleapis.com/oauth2/v3/certs`).
-   Validate issuer (`accounts.google.com` or
    `https://accounts.google.com`) and audience
    (`env.GOOGLE_CLIENT_ID`).
-   Account Resolution Flow:
    1.  If `google_sub` exists: return active user (reject deactivated
        with `403 ACCOUNT_DISABLED`).
    2.  If `email` exists without `google_sub`: do NOT automatically
        link solely because the email strings match unless the Google ID
        token has a verified email claim (`email_verified === true`) and
        the account-linking policy explicitly permits it. Perform the
        link atomically and reject conflicting Google subject links.
    3.  If user does not exist: generate `TX26XXXX` ID, insert user
        (`role: 'PARTICIPANT'`). User ID allocation must be
        concurrency-safe using a database sequence/counter row or
        unique-constraint-and-retry strategy; a `SELECT ... FOR UPDATE`
        over an empty result does not lock a nonexistent row.
    4.  Automatically link any pending team invitations:
        `UPDATE team_members SET user_id = ? WHERE invited_email = ? AND user_id IS NULL`.

------------------------------------------------------------------------

## 4. Session Architecture & Cookie Handling (`src/services/session.service.ts`)

-   **Raw Token:** Generate 32 cryptographically secure random bytes
    (64-character hex string).
-   **Database Storage:** Hash raw token using SHA-256 before inserting
    into the `sessions` table.
-   **Cookie Configuration:**
    -   Production: `__Host-session`,
        `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<ttl>`
    -   Development: `session`,
        `HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>`
-   **Sliding Expiration Rules:**
    -   **Participant:** TTL is 30 days. When validated with less than
        half TTL remaining (\< 15 days), extend `expires_at` by 30 days
        automatically.
    -   **Staff (`VOLUNTEER`, `LEAD`, `SUPER_ADMIN`):** Fixed 12-hour
        expiration without sliding extension.

------------------------------------------------------------------------

## 5. Auth Middleware (`src/middleware/auth.ts`)

-   `requireAuth()`: Extracts session cookie, hashes token, queries
    active non-revoked session, loads `req.user` and `req.session`.
-   `requireRole(allowedRoles)`: Verifies
    `allowedRoles.includes(req.user.role)`.
-   `requireProfileComplete()`: Ensures
    `req.user.profile_completed_at !== null`.
-   `requireSuperAdminOnly()`: Restricts access to `SUPER_ADMIN`.

------------------------------------------------------------------------

## 6. Profile Management & Student Locking (`src/services/profile.service.ts`)

-   **Profile Completeness Criteria:**
    1.  `name`: trimmed string length $\ge 2$.
    2.  `phone`: 10-digit Indian number matching `/^[6-9]\d{9}$/`.
    3.  If `is_student === 1`: `institution_name` and `institution_id`
        must be non-empty strings.
-   **Student Field Locking Invariant:**
    -   When a participant's student discount pass is approved,
        `student_fields_locked` is set to `1`.
    -   In `PATCH /api/me`, if `student_fields_locked === 1` and the
        user attempts to modify `is_student`, `institution_name`, or
        `institution_id`, throw `403 STUDENT_FIELDS_LOCKED`. Only a
        Super Admin can unlock or edit these fields.

------------------------------------------------------------------------

## 7. Routes Implementation (`src/routes/auth.ts` & `src/routes/me.ts`)

-   `POST /api/auth/register`: `{ email, password, name }` $\rightarrow$
    creates a new participant only if the normalized email is not
    already owned by an account. It must NEVER set a password on or
    otherwise claim an existing Google-linked or pre-registered staff
    account based only on knowledge of its email. Existing-account
    linking requires verified identity or a secure, expiring, single-use
    recovery/invitation flow.
-   `POST /api/auth/login`: `{ email, password }` $\rightarrow$ verifies
    password, creates session cookie.
-   `POST /api/auth/google`: `{ id_token }` $\rightarrow$ verifies
    Google JWT, links/creates user, sets session cookie.
-   `POST /api/auth/logout`: Revokes session in DB (`revoked_at = now`),
    clears cookie.
-   `GET /api/auth/session`: Returns
    `{ authenticated: true, user: FormattedUserProfile }`.
-   `GET /api/me`: Returns profile with `profile_complete: boolean` and
    `missing_fields: string[]`.
-   `PATCH /api/me`:
    `{ name?, phone?, is_student?, institution_name?, institution_id? }`
    (enforces student lock).

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Direct registration generates an ID starting with `TX26`
    (e.g. `TX260001`).
-   [ ] Google OAuth resolves existing users and sets session cookies.
-   [ ] Session cookie hashes are verified in constant time.
-   [ ] Participants get sliding session extensions; staff sessions
    expire in 12 hours.
-   [ ] Users with `student_fields_locked = 1` cannot edit their student
    or institution details.

## 7. Mandatory security fixes from source audit

### 7.1 Prevent password signup from claiming existing accounts (critical)

The current implementation's `registerWithPassword()` can set a password
on an existing account when that account has no password hash. This is
unsafe for Google-linked and pre-registered staff accounts.

Required behavior: - If normalized email already exists, public signup
must not attach a password to that account. - Return a generic,
non-enumerating response where appropriate; do not reveal whether the
email belongs to a staff account. - Account linking/password setup must
require proof of control: verified identity from an already
authenticated session, a short-lived single-use signed token sent to the
verified email, or an owner-approved equivalent. - Tokens must be
random, hashed at rest, expire, be single-use, and be rate-limited. -
Add regression tests proving an unauthenticated attacker cannot set a
password for an existing Google-linked user or pre-registered
LEAD/VOLUNTEER/SUPER_ADMIN. - Never allow public signup to choose
`role`, `is_active`, `can_review_payments`, or other privileged fields.

### 7.2 Authentication abuse controls

-   Add configurable rate limits to signup, password login, Google
    sign-in, account linking/recovery, and session-sensitive endpoints.
    Use shared storage if multiple server instances must enforce one
    global limit; do not assume in-memory limits are global in PM2
    cluster mode.
-   Validate Google `email_verified` before using email as a trusted
    account-linking key.
-   Keep error messages from enabling account enumeration.
-   Add tests for disabled accounts, conflicting Google subjects,
    malformed/expired tokens, duplicate concurrent signup, and session
    revocation.
-   Maintain compatibility with existing PBKDF2 hashes while documenting
    any approved upgrade policy.

### 7.3 Sequential user IDs

Do not rely on locking the highest existing user row: an empty table or
simultaneous requests can race. Use a dedicated counter/sequence or
retry on unique violation inside a bounded loop. Test concurrent
registration and Google signup.

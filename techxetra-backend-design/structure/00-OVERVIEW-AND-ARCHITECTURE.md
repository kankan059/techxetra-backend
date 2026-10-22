> REFERENCE STATUS: This document describes the previous implementation and is retained only as a domain/capability checklist. It is NOT the target runtime, schema, route contract, or authority when it conflicts with `docs/` or `GREENFIELD-BACKEND-SPEC.md`. Do not implement Hono, Workers, D1, SQLite, Wrangler, or old implementation-specific details from this file. Latest decisions in `docs/DECISIONS-AND-OPEN-CHOICES.md` supersede conflicting staff-payment, auth, privacy, concurrency, and schema behavior.

# 00 — Overview and Architecture

## 1. System Overview & Technology Stack

**TechXetra** is the annual technical fest of Tezpur University. The backend is a serverless, edge-native REST API built to handle ticket purchasing, manual UPI payment verification, QR check-in scanning, team rosters, and real-time e-sports scoring.

### Technology Stack
| Component | Technology | Rationale |
|---|---|---|
| **Runtime** | Cloudflare Workers (`workerd`) | Edge deployment, zero cold starts, global distribution |
| **Web Framework** | Hono v4 (`hono`) | Lightweight, ultra-fast TypeScript router designed for Edge runtimes |
| **Database** | Cloudflare D1 (SQLite) | Embedded edge SQL database with atomic statement batching |
| **Language** | TypeScript (Strict mode) | End-to-end type safety |
| **Input Validation** | Zod v3 (`zod`) | Strict runtime schema parsing (`.strict()`) rejecting unexpected fields |
| **Auth & Cryptography** | Web Crypto API + `jose` | PBKDF2-SHA256 password hashing, SHA-256 session token lookup, HMAC-SHA256 QR signatures, Google JWKS verification |
| **Test Runner** | Vitest | Rapid local unit and integration testing mocking D1 batches |

---

## 2. Non-Negotiable Engineering Invariants

Any developer or AI agent modifying this codebase MUST uphold these rules:

1. **No Interactive Transactions**: Cloudflare D1 does not support interactive transactions (`BEGIN ... COMMIT`). All atomic multi-statement operations must use `db.batch([stmt1, stmt2, ...])` and the `_guard` table.
2. **The "Verify-After-Write" Invariant**: SQLite conditional `UPDATE` statements that match 0 rows do **NOT** throw an error. You **must** append a `guardVerifyRow(...)` statement to every conditional write to ensure the batch rolls back if the row was not in the expected state.
3. **Monetary Safety**: Never use floating-point numbers for money. All prices, totals, and balances are integers in **paise** (`₹300.00` = `30000`).
4. **Time Safety**: All timestamps are 64-bit integer Unix epoch milliseconds (`Date.now()`). No local timezone strings are persisted in the database.
5. **Durable Payment Truth**: Never create tickets before a purchase is `PAID`. If ticket fulfillment fails after payment approval, **never downgrade the purchase back to unpaid**. Payment approval is durable truth; record `fulfillment_status = 'FAILED'` and allow retry.
6. **No Self-Review of Payments**: Reviewers with `can_review_payments`, `SUPER_ADMIN`, or assigned event `LEAD` cannot review, approve, or hold their own payment submissions.
7. **Append-Only Auditing**: `audit_logs`, `payment_audit_logs`, and `esports_score_history` have SQLite triggers that abort on `UPDATE` or `DELETE`. Never write code that attempts to mutate or delete audit rows.
8. **E-Sports Exclusivity**: Scoring and public leaderboards are strictly restricted to events with `category = 'E_SPORTS'` (enforced by SQL check constraint).
9. **Strict Validation**: All HTTP request bodies, query params, and path params must be validated with Zod `.strict()` schemas. Unknown fields must be rejected.
10. **Data Redaction**: Never log credentials, Google ID tokens, session tokens, HMAC secret keys, phone numbers, or bulk UTR data.

---

## 3. Session & Cookie Mechanics

### Session Token Architecture
- Session tokens are generated as 32-byte cryptographically random hex strings (64 characters).
- The raw token is stored on the client in an `HttpOnly` cookie.
- The database `sessions` table stores the **SHA-256 hex digest** of the raw token (`id` column), preventing session compromise in the event of database read leaks.

### Cookie Configuration
| Environment | Cookie Name | Directives |
|---|---|---|
| **Production** | `__Host-session` | `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<ttl>` |
| **Development** | `session` | `HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>` |
| **Cross-Origin Dev / Tunnel** | `session` | `HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=<ttl>` |

### Session Lifetimes & Sliding Window
- **`PARTICIPANT`**: Default TTL is 30 days (`2,592,000,000` ms). Employs sliding expiration: when validated with less than half TTL remaining (< 15 days), the expiration is automatically extended by 30 days.
- **Staff (`VOLUNTEER`, `LEAD`, `SUPER_ADMIN`)**: Default TTL is 12 hours (`43,200,000` ms). Fixed expiration window without sliding extension for elevated security.

---

## 4. Environment Bindings (`CloudflareBindings`)

Configured via `wrangler.jsonc` and `.dev.vars`:

```ts
export interface CloudflareBindings {
  DB: D1Database                         // Cloudflare D1 SQLite database binding
  ENVIRONMENT?: string                   // 'development' | 'production'
  GOOGLE_CLIENT_ID: string               // Google Identity OAuth Client ID
  FRONTEND_ORIGIN: string                // Allowed origin for CORS & CSRF checks (e.g. http://localhost:3000)
  TICKET_HMAC_SECRET: string             // Secret key for HMAC-SHA256 ticket QR signatures
  UPI_VPA: string                        // Festival UPI VPA address (e.g. example@bank)
  UPI_PAYEE_NAME: string                 // Legal payee name displayed in UPI apps
  PURCHASE_RESERVATION_TTL_MS?: string   // Default 15 mins (900,000 ms)
  PARTICIPANT_SESSION_TTL_MS?: string    // Default 30 days (2,592,000,000 ms)
  STAFF_SESSION_TTL_MS?: string          // Default 12 hours (43,200,000 ms)
  COOKIE_SAMESITE?: string               // Optional override ('none', 'lax', 'strict')
}
```

---

## 5. Execution Pipeline & Middleware Stack

Mounted sequentially in `src/app.ts`:
1. `requestIdMiddleware()`: Extracts or generates `X-Request-Id` (UUID v4) and stores `c.set('requestId')` and `c.set('now', Date.now())`. Attaches `X-Request-Id` to response headers.
2. `corsMiddleware()`: Validates `Origin` header against `FRONTEND_ORIGIN`. Handles `OPTIONS` preflight with `204 No Content` and attaches credentials headers.
3. `securityHeadersMiddleware()`: Sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Content-Security-Policy: default-src 'none'`, and HSTS in production.
4. `mutationOriginMiddleware()`: Protects state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) against CSRF attacks by strictly verifying `Origin` or `Referer` against `FRONTEND_ORIGIN`.
5. Route handlers (`src/routes/*`): Authenticate, validate Zod schemas, execute services.
6. Error handling:
   - `notFoundHandler`: Catches unmatched paths with standard `404 ROUTE_NOT_FOUND`.
   - `globalErrorHandler`: Catches `ZodError` (`400 VALIDATION_ERROR`), `AppError`, and unexpected errors (`500 INTERNAL_SERVER_ERROR`).

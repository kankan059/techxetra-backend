> REFERENCE STATUS: This document describes the previous implementation and is retained only as a domain/capability checklist. It is NOT the target runtime, schema, route contract, or authority when it conflicts with `docs/` or `GREENFIELD-BACKEND-SPEC.md`. Do not implement Hono, Workers, D1, SQLite, Wrangler, or old implementation-specific details from this file. Latest decisions in `docs/DECISIONS-AND-OPEN-CHOICES.md` supersede conflicting staff-payment, auth, privacy, concurrency, and schema behavior.

# 01 — Directory and File Index

This document provides a comprehensive, file-by-file inventory of the entire `backend/` codebase.

---

## 📁 Repository Structure Overview

```
backend/
├── migrations/             # Cloudflare D1 SQL schema migrations
├── scripts/                # Database seeding, hashing, and admin provisioning scripts
├── src/                    # TypeScript source code
│   ├── common/             # Errors, structured logger, response envelopes, utility functions
│   ├── db/                 # D1 batch execution, constraint error mapper, _guard builders
│   ├── middleware/         # Auth session check, role authorization, CORS, CSRF, security headers
│   ├── routes/             # Hono router controllers (HTTP layer)
│   ├── services/           # Business logic & database transaction preparation (Service layer)
│   ├── types/              # Domain entities, environment bindings, Hono AppVariables
│   ├── utils/              # QR token HMAC crypto signing & verification
│   ├── app.ts              # Hono application factory & route registration
│   └── index.ts            # Cloudflare Worker entrypoint (fetch + scheduled handler)
├── tests/                  # Vitest integration & concurrency test suite
├── tsconfig.json           # Strict TypeScript configuration
├── package.json            # Node/npm dependencies and script commands
└── wrangler.jsonc          # Cloudflare Worker deployment configuration
```

---

## 📄 File Inventory

### 1. Root & Entrypoints

| File | Architectural Role | Key Exports / Responsibilities |
|---|---|---|
| [`src/index.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/index.ts) | Worker Entrypoint | Exports default Worker object with `fetch(request, env, ctx)` and `scheduled(event, env, ctx)` handler. |
| [`src/app.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/app.ts) | Application Factory | `createApp()` initializes Hono app, attaches 4 global middlewares, mounts 23 route sub-routers, and registers error handlers. |
| [`wrangler.jsonc`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/wrangler.jsonc) | Cloudflare Worker Config | Defines worker name `techxetra-backend`, compatibility date, D1 database binding `DB`, and default environment variables. |
| [`package.json`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/package.json) | Package Manifest | Scripts (`dev`, `deploy`, `test`, `typecheck`, `seed:*`), dependencies (`hono`, `jose`, `zod`), and dev tools (`wrangler`, `vitest`). |
| [`tsconfig.json`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tsconfig.json) | TypeScript Configuration | Strict mode enabled, ES2022 target, NodeNext module resolution, Worker types included. |

---

### 2. Common & Utilities (`src/common/` & `src/utils/`)

| File | Purpose | Key Exports | Tables Touched |
|---|---|---|---|
| [`src/common/errors.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/common/errors.ts) | Application error model | `AppError` class, `ErrorCode` union type with 38 standard error codes. | None |
| [`src/common/response.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/common/response.ts) | Standard JSON envelopes | `jsonSuccess<T>(c, data, status)`, `jsonError(c, code, message, status, details)`, interface contracts. | None |
| [`src/common/logger.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/common/logger.ts) | Redacted JSON logger | `logger.info`, `logger.warn`, `logger.error`, `redactSensitiveData` (strips passwords, UTRs, tokens, phone numbers). | None |
| [`src/common/utils.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/common/utils.ts) | Formatting & helpers | `generateId()` (UUID v4), `getCurrentTimeMs()`, `normalizePhoneNumber()`, `normalizeTransactionId()`, `normalizeEmail()`, `rupeesToPaise()`, `paiseToRupees()`, `encodeCursor()`, `decodeCursor()`. | None |
| [`src/utils/qr.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/utils/qr.ts) | Tamper-proof QR crypto | `generateQrToken()`, `verifyAndParseQrToken()`, `generateQrSignature()`, `constantTimeEqual()`, `bufferToBase64Url()`. Implements `tx1.<ticket_id>.<version>.<hmac>` using Web Crypto HMAC-SHA256. | None |

---

### 3. Database & Batch Toolkit (`src/db/`)

| File | Purpose | Key Exports | Notes |
|---|---|---|---|
| [`src/db/guards.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/db/guards.ts) | D1 Batch Guard Statements | `guardWhen(db, condition, bindings)`<br/>`guardUnless(db, condition, bindings)`<br/>`guardVerifyRow(db, table, whereClause, bindings)` | Uses `INSERT INTO _guard (id) SELECT 1 WHERE ...` to trigger `CHECK(0)` on conflict, rolling back the batch. |
| [`src/db/constraints.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/db/constraints.ts) | SQLite Error Mapping | `mapDatabaseError(err, customGuardMsg)` maps SQLite error strings and unique index names into typed `AppError` instances (400, 403, 409). |
| [`src/db/batch.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/db/batch.ts) | Atomic Batch Runner | `executeBatch(db, statements, options)` executes statements in a single transaction via `db.batch()`, catching and mapping SQLite errors. |

---

### 4. Middleware Layer (`src/middleware/`)

| File | Purpose | Exported Handlers |
|---|---|---|
| [`src/middleware/request-id.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/middleware/request-id.ts) | Request Tracing | `requestIdMiddleware()` sets `requestId` and `now` in Hono context, adds `X-Request-Id` response header. |
| [`src/middleware/cors.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/middleware/cors.ts) | CORS Policy | `corsMiddleware()` validates origin against `FRONTEND_ORIGIN`, supports preflight `OPTIONS` and credentials headers. |
| [`src/middleware/security.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/middleware/security.ts) | Headers & CSRF | `securityHeadersMiddleware()` (CSP, nosniff, DENY frame options, HSTS).<br/>`mutationOriginMiddleware()` (CSRF protection for POST/PUT/PATCH/DELETE). |
| [`src/middleware/error-handler.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/middleware/error-handler.ts) | Global Error Catchers | `globalErrorHandler` (catches `ZodError`, `AppError`, system errors).<br/>`notFoundHandler` (catches 404s). |
| [`src/middleware/auth.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/middleware/auth.ts) | Authentication & Guards | `requireAuth()`, `optionalAuth()`, `requireProfileComplete()`, `requireRole(roles)`, `requireSuperAdminOnly()`, `requirePaymentReviewerOnly()`. |

---

### 5. Domain Types (`src/types/`)

| File | Description | Key Types |
|---|---|---|
| [`src/types/env.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/types/env.ts) | Hono Context Types | `CloudflareBindings`, `AppVariables`, `AppContext`. |
| [`src/types/index.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/types/index.ts) | Domain Entities & Enums | `User`, `UserRole`, `Session`, `FestDay`, `Event`, `EventCategory`, `EventStatus`, `PriceModel`, `CapacityUnit`, `Team`, `TeamStatus`, `TeamMember`, `Purchase`, `PurchaseStatus`, `PurchaseItem`, `Registration`, `Payment`, `PaymentStatus`, `Ticket`, `CheckInLog`, `EsportsScore`, `AuditLog`. |

---

### 6. Services Layer (`src/services/`)

| Service File | Responsibilities | Key Functions | Tables Touched |
|---|---|---|---|
| [`session.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/session.service.ts) | Session lifecycle, cookie generation, sliding TTL | `createSession`, `validateSession`, `revokeSession`, `hashSessionToken` | `sessions`, `users` |
| [`google-auth.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/google-auth.service.ts) | Google ID token verification via JWKS | `verifyGoogleIdToken` | None |
| [`password.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/password.service.ts) | PBKDF2 password hashing, registration, password login | `hashPassword`, `verifyPassword`, `registerWithPassword`, `loginWithPassword` | `users`, `team_members` |
| [`user.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/user.service.ts) | Google user resolution, staff pre-registration, sequential TX26 ID generation | `resolveOrCreateGoogleUser`, `preRegisterStaff`, `generateNextUserId` | `users`, `team_members` |
| [`profile.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/profile.service.ts) | Profile completeness calculation, profile editing | `computeProfileCompleteness`, `formatUserProfile`, `updateParticipantProfile` | `users` |
| [`authz.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/authz.service.ts) | Authorization asserts & staff assignments | `isSuperAdmin`, `canReviewPayments`, `isGateStaff`, `isEventStaff`, `assertSuperAdmin`, `assertEventStaff`, `assertOwnership` | `gate_staff`, `event_staff` |
| [`event.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/event.service.ts) | Public event browsing, event creation, updates, and safe deletion | `getPublicEvents`, `getEventByIdOrSlug`, `createEvent`, `updateEvent`, `deleteEventByAdmin`, `formatPublicEvent` | `events`, `fest_days`, `tickets`, `registrations`, `event_staff`, `audit_logs` |
| [`settings.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/settings.service.ts) | Global settings & fest day configurations | `getAllSettings`, `updateSettings`, `getAllFestDays`, `updateFestDay` | `settings`, `fest_days`, `tickets`, `events`, `audit_logs` |
| [`team.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/team.service.ts) | Team formation, invites, accept/decline, checkout validation | `createTeam`, `getTeamWithMembers`, `getUserTeams`, `inviteTeamMember`, `acceptTeamInvite`, `declineTeamInvite`, `removeTeamMember`, `cancelTeam`, `validateTeamForPurchase` | `teams`, `team_members`, `events`, `users`, `audit_logs` |
| [`purchase.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/purchase.service.ts) | Checkout reservations, capacity holding, automatic free fulfillment, cancellation | `createPurchase`, `getPurchaseById`, `getUserPurchases`, `releasePurchase` | `purchases`, `purchase_items`, `events`, `teams`, `registrations`, `tickets`, `settings`, `audit_logs` |
| [`payment.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/payment.service.ts) | Manual UPI submission, review queue, approval & ticket fulfillment | `getPaymentDetailsForPurchase`, `submitUpiPayment`, `getReviewQueue`, `reviewPayment`, `withdrawPayment` | `payments`, `purchases`, `payment_audit_logs`, `audit_logs`, `tickets`, `registrations`, `purchase_items`, `users` |
| [`ticket.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/ticket.service.ts) | Participant ticket view, signed QR token generation | `getUserTickets`, `getTicketWithToken`, `generateTicketQrToken` | `tickets`, `events`, `users` |
| [`scan.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/scan.service.ts) | Volunteer QR scanning, gate multi-entry, single-use event check-in | `lookupTicketByToken`, `admitAttendee` | `tickets`, `check_in_logs`, `events`, `users`, `gate_staff`, `event_staff` |
| [`esports.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/esports.service.ts) | Tournament scoring, round management, optimistic locking | `getEventScoreboard`, `recordScore`, `deleteScore`, `finalizeEventScoring`, `reopenEventScoring` | `esports_scores`, `esports_score_history`, `events`, `registrations`, `audit_logs` |
| [`audit.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/audit.service.ts) | Append-only audit log builders & queries | `createAuditStatement`, `getAuditLogs` | `audit_logs` |
| [`admin-user.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/admin-user.service.ts) | User directory, role promotion, deactivation | `getAdminUsers`, `updateAdminUser` | `users`, `audit_logs` |
| [`admin-ticket.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/admin-ticket.service.ts) | Ticket revocation, reissuance, QR rotation, undo check-in | `revokeTicket`, `reissueTicket`, `rotateQrVersion`, `undoCheckIn` | `tickets`, `check_in_logs`, `audit_logs` |
| [`admin-registration.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/admin-registration.service.ts) | Admin registration management, cancellation & capacity release | `getAdminRegistrations`, `cancelRegistrationByAdmin` | `registrations`, `events`, `tickets`, `audit_logs` |
| [`report.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/report.service.ts) | Financial totals, registration counts, gate check-in stats | `getSummaryReport`, `getEventAttendanceReport`, `getFinancialReport` | `purchases`, `payments`, `registrations`, `check_in_logs`, `events` |
| [`staff-event.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/staff-event.service.ts) | Event committee (Lead/Volunteer) dashboard, roster & payments | `getMyStaffEvents`, `getStaffEventDashboard`, `getStaffEventRegistrations`, `getStaffEventPayments`, `reviewStaffEventPayment` | `events`, `event_staff`, `registrations`, `tickets`, `payments`, `purchases` |
| [`idempotency.service.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/services/idempotency.service.ts) | Request deduplication cache | `checkIdempotency`, `saveIdempotency` | `idempotency_keys` |

---

### 7. Routes Layer (`src/routes/`)

| Route File | Base Path Mounted | Domain / Operations |
|---|---|---|
| [`health.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/health.ts) | `/` & `/api` | Root status, `/health` ping, `/ready` database connectivity check. |
| [`auth.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/auth.ts) | `/api/auth` | `/google`, `/register`, `/login`, `/logout`, `/session`. |
| [`me.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/me.ts) | `/api/me` | `GET /` (current user profile), `PATCH /` (update profile). |
| [`catalog.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/catalog.ts) | `/api/catalog` | `GET /passes` (fest gate pass prices, fest days, settings). |
| [`events.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/events.ts) | `/api/events` | `GET /` (search/filter events), `GET /:idOrSlug` (single event details). |
| [`leaderboards.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/leaderboards.ts) | `/api/leaderboards` | `GET /:eventId` (public tournament scoreboards). |
| [`teams.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/teams.ts) | `/api/teams` | `POST /`, `GET /mine`, `GET /:id`, `DELETE /:id`, `POST /:id/invite`, `DELETE /:id/members/:memberId`. |
| [`team-invites.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/team-invites.ts) | `/api/team-invites` | `GET /mine`, `POST /:memberId/accept`, `POST /:memberId/decline`. |
| [`purchases.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/purchases.ts) | `/api/purchases` | `POST /` (checkout reservation), `GET /mine`, `GET /:id`, `POST /:id/cancel`. |
| [`payments.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/payments.ts) | `/api` | `GET /purchases/:id/payment`, `POST /purchases/:id/payment`, `POST /purchases/:id/payment/withdraw`. |
| [`tickets.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/tickets.ts) | `/api/tickets` | `GET /mine`, `GET /:id` (with signed QR token). |
| [`registrations.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/registrations.ts) | `/api/registrations` | `GET /mine` (participant confirmed/reserved registrations). |
| [`staff-scan.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/staff-scan.ts) | `/api/staff/scan` | `POST /lookup` (decode & inspect QR), `POST /admit` (execute admission). |
| [`staff-events.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/staff-events.ts) | `/api/staff/events` | `GET /mine`, `GET /:id/dashboard`, `GET /:id/registrations`, `GET /:id/payments`, `POST /:id/payments/:paymentId/review`, `PATCH /:id`. |
| [`staff-esports.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/staff-esports.ts) | `/api/staff/events` | `POST /:id/scores`, `DELETE /:id/scores/:scoreId`, `POST /:id/finalize`, `POST /:id/reopen`. |
| [`admin-users.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-users.ts) | `/api/admin/users` | `GET /` (search users), `PATCH /:id` (role, active state, reviewer permissions). |
| [`admin-events.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-events.ts) | `/api/admin/events` | `POST /` (create event), `PATCH /:id` (full update), `DELETE /:id` (safe delete/cancel), `POST/DELETE /:id/staff`. |
| [`admin-payments.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-payments.ts) | `/api/admin/payments` | `GET /` (queue), `GET /:id`, `POST /:id/review` (approve/reject/hold). |
| [`admin-purchases.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-purchases.ts) | `/api/admin/purchases` | `GET /` (list), `GET /:id`, `POST /:id/retry-fulfillment`. |
| [`admin-tickets.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-tickets.ts) | `/api/admin/tickets` | `POST /:id/revoke`, `POST /:id/reissue`, `POST /:id/rotate-qr`, `POST /:id/undo-checkin`. |
| [`admin-registrations.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-registrations.ts) | `/api/admin/registrations` | `GET /`, `POST /:id/cancel` (cancel registration & release capacity). |
| [`admin-reports.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-reports.ts) | `/api/admin/reports` | `GET /summary`, `GET /financial`, `GET /attendance`. |
| [`admin-audit.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin-audit-logs` | `/api/admin/audit-logs` | `GET /` (paginated audit trails with action/target/actor filters). |
| [`admin-settings.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/admin` | `/api/admin` | `PATCH /settings`, `PATCH /fest-days/:dayNumber`. |

---

### 8. Database Migrations (`migrations/`)

| Migration File | Description |
|---|---|
| [`0001_init.sql`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/migrations/0001_init.sql) | Core database schema, partial unique indices, check constraints, append-only triggers, and the `_guard` table. |
| [`0002_seed.sql`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/migrations/0002_seed.sql) | Initial seed data: Fest days 1, 2, and 3, default gate pass prices, purchases enabled, and support email. |
| [`0003_add_password_auth.sql`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/migrations/0003_add_password_auth.sql) | Adds `password_hash` column to `users` table for email/password authentication. |
| [`0003_custom_forms_and_event_enhancements.sql`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/migrations/0003_custom_forms_and_event_enhancements.sql) | Dynamic registration form schemas (`form_schema`), attendee questionnaire answers (`form_responses`), and performance indices (`event_staff`, `purchase_items`). |

---

### 9. Operator Scripts (`scripts/`)

| Script | Purpose |
|---|---|
| [`scripts/bootstrap-admin.sql`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/scripts/bootstrap-admin.sql) | SQL script to elevate a specific user email to `SUPER_ADMIN` and `can_review_payments = 1`. |
| [`scripts/generate-hashes.mjs`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/scripts/generate-hashes.mjs) | Generates PBKDF2 password hashes for seeding dummy accounts. |
| [`scripts/import-events.mjs`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/scripts/import-events.mjs) | Ingests `techxetra_2026_events.json` and inserts event records into D1. |
| [`scripts/seed-staff.mjs`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/scripts/seed-staff.mjs) | Generates `seed-staff-users.sql` with default credentials for staff roles. |

---

### 10. Automated Tests (`tests/`)

| Test Suite | Purpose & Coverage |
|---|---|
| [`tests/foundation.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/foundation.test.ts) | System bootstrap, environment variables, health and readiness checks. |
| [`tests/auth.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/auth.test.ts) | Google OAuth JWKS verification, session lifecycle, sliding TTLs. |
| [`tests/password-auth.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/password-auth.test.ts) | Native password registration, PBKDF2 hashing, login verification. |
| [`tests/profile-authz.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/profile-authz.test.ts) | Profile completion, student verification locking, and role authorization asserts. |
| [`tests/teams.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/teams.test.ts) | Team creation, invitation workflow, accepting/declining, team disbanding. |
| [`tests/purchases-capacity.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/purchases-capacity.test.ts) | 15-minute reservation timer, capacity deduction, oversell prevention, atomic rollback. |
| [`tests/payments.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/payments.test.ts) | Manual UPI submission, review queue, approval/rejection/hold, ticket fulfillment. |
| [`tests/tickets.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/tickets.test.ts) | Signed HMAC QR token generation, token verification, ticket detail retrieval. |
| [`tests/scanning.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/scanning.test.ts) | Volunteer QR scanning, gate multi-entry, single-use event check-in. |
| [`tests/esports.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/esports.test.ts) | E-Sports scoring, optimistic concurrency locking, scoreboards, finalize/reopen. |
| [`tests/staff-events-and-forms.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/staff-events-and-forms.test.ts) | Event committee hub, roster, payment review, dynamic form schema validation, safe event deletion. |
| [`tests/catalog-and-event-admin.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/catalog-and-event-admin.test.ts) | Catalog passes, event creation, Super Admin updates, capacity constraints. |
| [`tests/admin.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/admin.test.ts) | User management, ticket lifecycle overrides, reports, settings, audit trails. |
| [`tests/batch-guard.test.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/tests/batch-guard.test.ts) | D1 atomic multi-statement batch rollback verification using the `_guard` table. |

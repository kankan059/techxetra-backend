# TechXetra Backend --- Node.js + Express + PostgreSQL Migration Task Pack

This task pack provides a complete, step-by-step implementation guide
for an AI agent or engineer to migrate the TechXetra backend from
**Hono + Cloudflare Workers + D1 (SQLite)** to **Node.js + Express +
PostgreSQL (using Drizzle ORM)**.

------------------------------------------------------------------------

## 🧭 Navigation & Task Index

  --------------------------------------------------------------------------------------------------------------------------------------------------------
  Task File                                                                                                  Scope & Focus    Key Deliverables
  ---------------------------------------------------------------------------------------------------------- ---------------- ----------------------------
  **[`TASK-01-PROJECT-SETUP-AND-ENV.md`](./TASK-01-PROJECT-SETUP-AND-ENV.md)**                               Foundation &     Node.js, Express,
                                                                                                             Infrastructure   TypeScript, Docker Compose
                                                                                                                              (Postgres 16), connection
                                                                                                                              pooling, `.env` schema
                                                                                                                              validation.

  **[`TASK-02-POSTGRES-SCHEMA-AND-MIGRATIONS.md`](./TASK-02-POSTGRES-SCHEMA-AND-MIGRATIONS.md)**             Database Schema  complete source-derived
                                                                                                             (Drizzle ORM)    PostgreSQL schema,
                                                                                                                              PostgreSQL enums, foreign
                                                                                                                              keys, partial unique
                                                                                                                              indexes, check constraints,
                                                                                                                              initial seed data.

  **[`TASK-03-MIDDLEWARE-AND-FOUNDATION.md`](./TASK-03-MIDDLEWARE-AND-FOUNDATION.md)**                       Core Middleware  Request ID tracing,
                                                                                                             & Response Layer structured logger, standard
                                                                                                                              JSON envelopes, centralized
                                                                                                                              error mapping, CORS, Helmet,
                                                                                                                              CSRF, health routes.

  **[`TASK-04-AUTH-SESSIONS-AND-PROFILE.md`](./TASK-04-AUTH-SESSIONS-AND-PROFILE.md)**                       Identity, Auth & Sequential `TX26XXXX` User
                                                                                                             User Profile     ID, PBKDF2 email/password
                                                                                                                              auth, Google OAuth (JWKS),
                                                                                                                              sliding sessions, profile
                                                                                                                              completeness, student lock.

  **[`TASK-05-CATALOG-EVENTS-AND-LEADERBOARDS.md`](./TASK-05-CATALOG-EVENTS-AND-LEADERBOARDS.md)**           Public Events &  Festival pass pricing,
                                                                                                             Tournaments      public event browsing with
                                                                                                                              search/filters/pagination,
                                                                                                                              seat calculation, public
                                                                                                                              tournament leaderboards.

  **[`TASK-06-TEAMS-AND-INVITATIONS.md`](./TASK-06-TEAMS-AND-INVITATIONS.md)**                               Teams & In-App   Team state machine (DRAFT
                                                                                                             Invitations      -\> LOCKED -\> CONFIRMED),
                                                                                                                              in-app invites on website
                                                                                                                              dashboard, accept/decline,
                                                                                                                              roster rules.

  **[`TASK-07-PURCHASES-AND-INVENTORY-RESERVATION.md`](./TASK-07-PURCHASES-AND-INVENTORY-RESERVATION.md)**   Checkout &       Native Postgres transactions
                                                                                                             15-Minute Seat   with row-level locking
                                                                                                             Hold             (`FOR UPDATE`), 15-minute
                                                                                                                              countdown, pricing matrix,
                                                                                                                              dynamic form validation,
                                                                                                                              free passes.

  **[`TASK-08-PAYMENTS-AND-UPI-VERIFICATION.md`](./TASK-08-PAYMENTS-AND-UPI-VERIFICATION.md)**               Manual UPI       UPI intent links, UTR
                                                                                                             Payments & Super submission with
                                                                                                             Admin Review     deduplication, timer pause,
                                                                                                                              payment review desk,
                                                                                                                              anti-self-dealing, durable
                                                                                                                              payment truth.

  **[`TASK-09-DIGITAL-TICKETS-AND-QR-SCANNING.md`](./TASK-09-DIGITAL-TICKETS-AND-QR-SCANNING.md)**           Tickets, HMAC QR Signed QR tokens
                                                                                                             Codes & Check-In (`tx1.<id>.<ver>.<hmac>`),
                                                                                                                              participant ticket view,
                                                                                                                              volunteer pre-scan lookup,
                                                                                                                              single-use event check-in,
                                                                                                                              pass-back warning.

  **[`TASK-10-ESPORTS-TOURNAMENT-SCORING.md`](./TASK-10-ESPORTS-TOURNAMENT-SCORING.md)**                     E-Sports Scoring Round score management,
                                                                                                             Engine           optimistic concurrency
                                                                                                                              versioning
                                                                                                                              (`expected_version`),
                                                                                                                              finalize/reopen scoring,
                                                                                                                              immutable score history.

  **[`TASK-11-STAFF-AND-COMMITTEE-PORTAL.md`](./TASK-11-STAFF-AND-COMMITTEE-PORTAL.md)**                     Event Committee  Staff dashboard with live
                                                                                                             Hub              metrics, attendee rosters
                                                                                                                              with custom question
                                                                                                                              answers, event-scoped
                                                                                                                              participant roster and
                                                                                                                              metadata edits (no payment
                                                                                                                              review).

  **[`TASK-12-ADMIN-MANAGEMENT-REPORTS-AND-AUDIT.md`](./TASK-12-ADMIN-MANAGEMENT-REPORTS-AND-AUDIT.md)**     Super Admin      User directory & role
                                                                                                             Control Suite    promotion, safe event
                                                                                                                              deletion, staff assignment,
                                                                                                                              ticket lifecycle overrides,
                                                                                                                              settings,
                                                                                                                              financial/attendance
                                                                                                                              reports, audit logs.

  **[`TASK-13-TESTING-DOCKER-AND-DEPLOYMENT.md`](./TASK-13-TESTING-DOCKER-AND-DEPLOYMENT.md)**               Verification &   End-to-end integration test
                                                                                                             Production Setup suite, multi-stage
                                                                                                                              `Dockerfile`, PM2 cluster
                                                                                                                              configuration for multi-core
                                                                                                                              performance.
  --------------------------------------------------------------------------------------------------------------------------------------------------------

------------------------------------------------------------------------

## ⚡ Instructions for the AI Coding Agent

1.  **Reference Authoritative Docs:** Always consult
    `backend/structure/` for the complete API contracts, field names,
    and business rules.
2.  **Execute In Numeric Order:** Execute Task 01 through Task 13
    sequentially. Do not skip tasks.
3.  **Preserve All Non-Negotiable Invariants:**
    -   **Monetary Precision:** All money stored and computed in integer
        **paise** (`₹100` = `10000`). Never use floating-point numbers.
    -   **Time Safety:** All timestamps are 64-bit Unix epoch
        milliseconds (`Date.now()`).
    -   **Native Transactions:** Use PostgreSQL interactive transactions
        (`db.transaction(async (tx) => ...)`) with row-level locks
        (`SELECT ... FOR UPDATE`) to prevent overselling. Do not
        re-create the D1 `_guard` table.
    -   **Sequential User IDs:** All users must be assigned IDs
        formatted as `TX26XXXX` (e.g., `TX260001`).
    -   **Durable Payment Truth:** Once a payment is approved, the
        purchase is permanently `PAID`. If ticket generation fails,
        leave it `PAID` with `fulfillment_status = 'FAILED'` so it can
        be retried without double charging.
    -   **Payment authority:** Only `SUPER_ADMIN` may review payments.
        Event Leads and Volunteers cannot review payments. Super Admin
        must never review their own purchase.
    -   **In-App Team Invitations:** Team invitations must be in-app
        records visible on the user's dashboard (not external emails).
    -   **Append-Only Auditing:** Maintain immutable audit logs for all
        administrative actions, payment transitions, and score
        modifications.
    -   **Strict Validation:** Use Zod schemas with `.strict()` on all
        request bodies, query parameters, and URL route parameters.
    -   **Data Redaction:** Never log passwords, tokens, bank UTRs, or
        phone numbers.

## Mandatory source-audit decision docs

Before coding, read
`../MIGRATION-DECISIONS-AND-SECURITY-REQUIREMENTS.md` and
`../SOURCE-CODE-AUDIT-FINDINGS.md`. These resolve important ambiguities
in this task pack, especially Super Admin-only payment verification,
event-scoped staff permissions, signup account claiming, dynamic forms,
and the team roster.

If an older task statement conflicts with those decision docs, follow
the decision docs and update the task implementation accordingly. Do not
silently reintroduce event-lead payment review.

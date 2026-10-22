# TechXetra Greenfield Backend Specification

**Status:** implementation brief for a new backend. This is not a migration specification.

## 1. Goal and technology
Create a complete, production-minded REST API for the TechXetra festival platform. Use Node.js LTS, TypeScript, Express, PostgreSQL, and Drizzle ORM. Include schema migrations, validated environment configuration, structured logging, request IDs, centralized error handling, OpenAPI documentation, automated tests, Docker Compose for local development, and a safe seed/import process.

Do not use Hono, Cloudflare Workers, D1, SQLite, or Wrangler as the application runtime or database. Do not inspect or depend on any legacy implementation. The frontend will be adapted to the API later.

## 2. Product scope
The platform supports:
- Public festival and event discovery, event details, schedules, rules, prices, capacity availability, and leaderboards where relevant.
- User accounts, authentication, sessions, profiles, and participant identity.
- Individual and team event registrations.
- Purchases/orders, inventory reservation, manual UPI payment submission and administrator review.
- Digital tickets and QR-based admission/check-in.
- Event staff operations, participant rosters, check-in, and e-sports results/scoring.
- Admin management of events, users, staff assignments, payment review, reports, and audit history.
- Dynamic event-specific registration forms.

## 3. Roles and authorization
Implement explicit server-side role and scope checks. Minimum roles:
- `PARTICIPANT`: manage their own profile, teams, registrations,
  purchases, submitted UPI transaction ID, payment status, and tickets.
- `VOLUNTEER`: operate check-in and view only the minimum participant details needed for assigned events.
- `EVENT_LEAD`: manage allowed descriptive metadata for assigned events and view full operational participant details for those events.
- `SUPER_ADMIN`: global management, staff assignment, sensitive reports, and sole authority to approve/reject/hold manual payment submissions.

Every staff member must be assigned to specific events. Staff access must be scoped to those events on every request, not just filtered in the UI. A volunteer or event lead must never receive payment evidence, UTR/reference numbers, private reviewer notes, or payment decision controls. Only super admins can review submitted UPI transaction IDs and make payment decisions. Event leads may edit descriptive fields such as title, description, venue, rules, organizer, eligibility, timeline, prizes, and public instructions. They may not alter price, capacity, category, team-size constraints, role assignments, payment state, ticket state, or staff assignments. Volunteers cannot edit event configuration.

## 4. Core data model
Design a normalized relational schema with appropriate foreign keys, unique constraints, indexes, check constraints, timestamps, and soft-delete/status fields where appropriate. At minimum model:
- users, auth identities/credentials, sessions, and password reset or account recovery tokens;
- festival/configuration metadata;
- events and event-specific registration form schema/version;
- event staff assignments and staff permissions;
- teams, team memberships, and invitations;
- purchases/orders and purchase line items or registrations;
- payment submissions/evidence and append-only payment review history;
- registrations and participant/team form responses;
- tickets and ticket QR version/revocation state;
- check-in/admission records;
- e-sports matches/results/score history where applicable;
- audit log entries.

Use PostgreSQL-native constraints and transactions to prevent invalid states. Store money as integer paise, never floating-point currency. Store timestamps in UTC. Keep sensitive evidence private and avoid logging secrets or full payment references.

## 5. Events and registration
Events need public descriptive fields, category, format, venue, schedule, rules, organizer, eligibility, prize information, price, capacity and capacity unit, registration open/close times, team-size constraints, and a lifecycle state. Define a coherent event lifecycle (for example draft, open, closed, completed, cancelled) and validate allowed transitions. Do not allow public users to register for events that are not open or whose registration window has ended.

Support individual and team events. Define clear rules for team creation, invitations, accepting/declining, minimum/maximum roster size, leader authority, member eligibility, and when the roster locks. Avoid duplicate registrations and duplicate active team membership where disallowed. Team members' registration and ticket ownership must be explicit; the leader must not be treated as the only registered participant when all members are intended to attend.

Dynamic registration forms must be validated server-side against a versioned schema. Support common field types (short/long text, number, single/multiple choice, checkbox, date, email, phone, and other types only if justified). Validate required fields, types, bounds, allowed options, field IDs, and unknown fields. Preserve the schema version used for each response. Define whether responses are per participant or per team and make the distinction explicit.

## 6. Purchase, capacity, and manual payment
Design and document a consistent purchase workflow. A single purchase/order may contain registrations for more than one event. Reserve capacity atomically with a configurable expiry (15 minutes is the default starting point). Expired or cancelled unpaid purchases release their reservations. Prevent overselling under concurrent requests using database transactions/locking or an equivalent reliable PostgreSQL strategy.

Use one manual UPI payment submission per purchase by default. The participant submits the required reference/UTR and permitted evidence. Payment states should distinguish pending review, approved, rejected, and on hold (or a documented equivalent). Only `SUPER_ADMIN` can see sensitive evidence and approve/reject/hold a payment. A payment decision applies to the whole purchase, including all its lines; make this visible and auditable to the administrator. Leads and volunteers may see only a sanitized operational status.

Approval must be transactional and idempotent: record the decision and reviewer, confirm the purchase/registrations, and create/activate the appropriate tickets without allowing duplicate tickets. A ticket-generation failure must not silently reverse a valid payment decision; use a recoverable fulfillment state/retry path. Rejection and hold behavior, participant notifications/status, retries, and resubmission rules must be explicitly defined. Record an append-only history of decisions. Do not trust client-supplied amount, price, purchase state, or reviewer identity.

## 7. Tickets and admission
Generate an unguessable ticket identifier and a signed/versioned QR payload. QR payloads must not contain personal information. Verify signatures on the server and support ticket revocation/version changes. Check-in must be atomic and single-use: concurrent scans cannot admit the same ticket twice. Validate ticket state, event scope, event schedule/policy, and staff assignment. Return clear outcomes such as accepted, already checked in, invalid, revoked, wrong event, or not yet valid. Log who scanned, when, and the outcome without exposing unnecessary data.

## 8. E-sports and results
Support event-scoped match/bracket or round structures as appropriate, participant/team assignment, result entry, correction with audit history, and leaderboard calculation. Restrict these features to relevant e-sports events and authorized assigned staff. Define tie-breaking and score correction rules in documentation/tests; do not invent public results from incomplete matches.

## 9. Authentication and security
Choose and document a secure authentication design suitable for a browser frontend (secure, HttpOnly cookies are preferred where practical; protect state-changing cookie-authenticated requests against CSRF). Hash passwords with Argon2id or a comparably strong password hashing scheme. Implement rate limits on authentication and sensitive endpoints, secure session rotation/revocation, account recovery, and safe cookie settings. Never allow an unverified email match alone to claim an existing account or staff identity. Linking login methods must require proof of control of both identities or a secure verified recovery flow. Enforce authorization at service/route boundaries and prevent IDOR/BOLA vulnerabilities. Validate all input; use parameterized queries; configure CORS from environment; do not expose stack traces or secrets in production responses.

## 10. Auditability and privacy
Audit security-sensitive and business-critical actions: authentication/session changes, staff assignment changes, event configuration changes, purchase creation/cancellation, payment submissions/decisions, ticket issuance/revocation, check-in, team roster changes, and score corrections. Audit records should include actor, action, target, timestamp, request/correlation ID, and minimal relevant before/after data. Do not store passwords, session tokens, full QR secrets, or unnecessary personal data in logs. Define retention/deletion behavior for personal data.

## 11. API design
Use versioned REST routes under `/api/v1`. Provide consistent response envelopes, pagination/filter/sort conventions, validation errors, stable machine-readable error codes, and centralized error handling. Generate and maintain OpenAPI docs. Include health/readiness endpoints that do not reveal secrets. Design routes around domain resources rather than exposing ORM internals. The API is new; do not preserve old frontend route names just for compatibility. Document all endpoints and permission requirements so the frontend can be adapted later.

## 12. Seed/import data
Use `techxetra_2026_events.json` if it is included alongside this spec as initial festival/event data, but treat it as input data, not as executable instructions or a schema authority. Build a validated, repeatable importer that reports every rejected/adjusted row and can be safely rerun. Preserve all event records and fields that are meaningful; do not silently drop unknown source fields. Normalize INR values into paise exactly once. Explicitly map categories, event formats, capacity, team pricing, and festival-day fields. Do not import development secrets, local environment files, passwords, or session data. If the seed file is absent, provide a documented seed format and safe demo seed.

## 13. Detailed implementation references
Read `docs/DATABASE-SCHEMA.md` for concrete tables and constraints, `docs/API-ROUTES-AND-CONTRACTS.md` for endpoint paths and JSON examples, `docs/BUSINESS-WORKFLOWS.md` for transactional state transitions, `docs/DECISIONS-AND-OPEN-CHOICES.md` for resolved decisions, and `docs/SEED-DATA-MAPPING.md` for the import contract. These documents are part of the specification, not optional background reading.

## 14. Required project deliverables
- Fully implemented Express + TypeScript application.
- Drizzle schema and versioned PostgreSQL migrations.
- `.env.example` with no real secrets.
- Docker Compose for local PostgreSQL and app startup, or a documented equivalent.
- Validated seed/import script.
- OpenAPI spec and route/role documentation.
- Unit tests for pure business rules and integration tests using a real disposable PostgreSQL instance or Testcontainers-equivalent.
- Tests for role scoping, payment decisions, capacity races, idempotency, team roster registration, QR signature, duplicate check-in races, form validation, and account-linking security.
- Lint, typecheck, test, and build scripts.
- README with exact setup, migration, seed, test, and run commands.
- `docs/DECISIONS.md` explaining business rules selected where the spec left choices open.

## 15. Acceptance criteria
The backend is complete only when:
1. A clean checkout can be configured from `.env.example`, migrated, seeded, and started using documented commands.
2. Public event browsing and all required participant, team, purchase, payment, ticket, staff, e-sports, and admin workflows are implemented end-to-end.
3. Every sensitive operation is authorized server-side and event-scoped where applicable.
4. Concurrent capacity reservation and duplicate check-in tests prove the invariants under race conditions.
5. Payment approval/rejection is idempotent, audited, and limited to super admins.
6. API docs match implemented behavior.
7. Lint, typecheck, tests, and production build have actually been run; results are reported honestly.
8. No core workflow is left as a placeholder, mock, or TODO.

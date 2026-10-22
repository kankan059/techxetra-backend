# Resolved Decisions and Choices the Agent Must Document

This file reduces unnecessary design work. Treat decisions below as fixed. For remaining choices, choose a secure, simple behavior and record it in the generated `docs/DECISIONS.md` with rationale and tests.

## Fixed decisions
1. Greenfield implementation: Node.js LTS, TypeScript, Express, PostgreSQL, Drizzle ORM. Do not migrate or inspect old runtime code.
2. API prefix `/api/v1`; JSON REST API; OpenAPI documentation is required.
3. Roles are `PARTICIPANT`, `VOLUNTEER`, `EVENT_LEAD`, `SUPER_ADMIN`. Only Super Admin assigns staff roles and event assignments.
4. Event leads and volunteers are scoped only to explicitly assigned events. Every staff query and mutation must enforce that scope server-side.
5. Only Super Admin can review manual UPI payments or view evidence/UTR/private review notes. One payment submission is for the entire purchase/order; an admin decision affects every item in that purchase.
6. Event leads may edit descriptive/public event metadata only. They cannot edit pricing, capacity, category, format/team limits, staff assignments, payment/ticket states, or scoring permissions. Volunteers cannot edit event configuration.
7. Event Lead roster view can contain full operational participant details; Volunteer gets a reduced, privacy-minimized view. Neither receives payment evidence, UTR, private reviewer notes, or payment controls.
8. Store money as integer paise. Normalize INR seed values exactly once. Never use floating point for money.
9. Capacity reservation is atomic; default reservation TTL is 15 minutes. Multi-event order reserves all lines or none.
10. Ticket fulfillment must be idempotent and recoverable. A valid approved payment is not downgraded because ticket generation failed.
11. QR tickets are signed/versioned, contain no PII, and check-in is atomic single-use.
12. Registration form schemas are versioned and immutable after publication; every response refers to the exact version.
13. Audit payment decisions, staff assignment, role changes, event config changes, purchase lifecycle, ticket lifecycle, check-in, and score corrections. Audit/history records are append-only at application level.
14. Use secure password hashing, session token hashes, secure cookies, CSRF protection where cookie auth is used, rate limits, validated input, and no secrets in logs.
15. Frontend may be changed later. Do not preserve old route names solely for compatibility.

## Choices to make and document
- Whether authentication supports Google OAuth in v1 or only email/password initially. If Google is included, verify ID tokens against Google's keys and issuer/audience; do not accept decoded claims without signature verification.
- No email delivery provider or email-sending service is required.
  Do not implement email notifications or email verification emails.
  Preserve the existing account authentication requirements.
- Exact UTR validation regex/length and whether a rejected UTR may be resubmitted. Approved UTR must never be reused.
- What happens to capacity after payment rejection and how long a participant has to resubmit. Document timer and status transitions explicitly.
- Whether an order with a submitted payment holds capacity beyond the 15-minute initial reservation; do not silently release seats while it is under admin review.
- Cancellation/refund policy for paid orders and cancelled events. Do not imply automated refunds unless implemented.
- Exact supported dynamic-form schema shape and participant/team response scopes.
- Exact student-price eligibility rules and how a mixed-eligibility team is priced. Do not infer from client-provided booleans.
- Team invitation expiry, whether a user can join multiple teams in one event, and when team roster locks/unlocks.
- Whether event capacity counts seats, teams, or entries per event. Each event must declare its unit.
- E-sports bracket/match model, scoring ranges, tie-break rules, and who may enter/correct/finalize results.
- Public profile fields, audit retention, personal-data retention/deletion, and evidence retention.
- Notifications (email/in-app) and retry strategy.

## Required `docs/DECISIONS.md` format
For each decision: `ID`, question, selected behavior, alternatives considered, security/data implications, and tests proving the behavior. Do not repeat fixed decisions unless documenting implementation detail.

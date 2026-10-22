# Capability Crosswalk and Latest Fixes

This document ensures the new backend preserves the product capabilities and fixes discussed for TechXetra without depending on the previous `/src` code. It supplements, but does not replace, the canonical schema, route contracts, and workflows.

## Authority when documents conflict
1. `docs/DECISIONS-AND-OPEN-CHOICES.md` for explicitly settled decisions and role/payment/security overrides.
2. `docs/DATABASE-SCHEMA.md` for target PostgreSQL entities and constraints.
3. `docs/API-ROUTES-AND-CONTRACTS.md` for the new route names, methods, payloads, and response envelope.
4. `docs/BUSINESS-WORKFLOWS.md` for state transitions and transactional behavior.
5. `GREENFIELD-BACKEND-SPEC.md` and tasks for overall acceptance and build order.
6. `structure/*-LEGACY-REFERENCE.md` only as a checklist of historical capabilities. It must not override items 1–5.

## Capabilities that must exist in the finished backend

| Domain | Required capability | Required safety/behavior |
|---|---|---|
| Runtime | Express + TypeScript + PostgreSQL + Drizzle | No Hono, Workers, D1, SQLite, Wrangler dependency |
| Health | Process health and DB readiness | Readiness checks DB; no secrets in output |
| Identity | Email/password, optional Google identity, sessions, logout, profile | Never trust client role; secure identity linking; hashed session tokens |
| Profile | Participant profile and student/institution fields | Server-controlled lock rules; private fields excluded from public output |
| Festival | Settings and festival days | Public settings allowlist; secrets never in settings table |
| Events | Public catalog, filters, detail, lifecycle, admin CRUD | Drafts private; price/capacity/team constraints protected; soft lifecycle after history exists |
| Dynamic forms | Schema creation/versioning/publishing and responses | Immutable published versions; type/options/bounds/unknown-field validation; team and participant scopes distinct |
| Teams | Create, rename, invite, accept/decline, remove/leave, disband | Event-scoped, invitation bound to identity/email, roster limits and lock state enforced |
| Checkout | Multi-event purchase, price snapshots, capacity reservation | One transaction or no effects; server computes price; idempotency; 15-minute default TTL |
| Free orders | Zero-value registration | No UPI review; confirm and fulfill idempotently |
| Payments | UPI UTR/evidence submission, hold/reject/approve | One submission applies to whole purchase; only Super Admin sees sensitive details and decides |
| Payment review | Queue, detail/evidence, decision history | Decision is audited/idempotent; paid state cannot be undone by ticket failure |
| Tickets | One ticket per attendee registration | Collision-safe public IDs; unique registration-to-ticket; signed versioned QR |
| Admission | Lookup and check-in, logs, correction | Lookup non-consuming; check-in atomic single-use; correction append-only |
| Staff | Assigned-event dashboard and participant roster | Every request scoped server-side to active assignment |
| Lead | Event operational details and limited public metadata edits | Cannot edit pricing, capacity, category, format, staff, payment, tickets, or protected scoring settings |
| Volunteer | Scanner and reduced roster | No default email/phone/institution ID, UTR, evidence, reviewer note, or payment actions |
| E-sports | Matches, result entry/correction, finalize/reopen, leaderboard | E_SPORTS-only; participant/event consistency; append-only result history; reason for reopening/correction |
| Admin | Users, events, assignments, purchases, registrations, tickets, reports, settings, audit | Explicit state transitions, reasoned destructive/override actions, audit all mutations |
| Reporting | Financial, attendance, event, registration, operational metrics | Filter/scope and export privacy rules enforced server-side |
| Operations | Reservation expiry, ticket fulfillment retry, seed import, bootstrap admin | Jobs idempotent; errors observable; no secret seed data |

## Latest fixes that are mandatory

1. **Admin-only payment review.** Remove event-lead payment queue/review behavior. Do not leak UTR, evidence, or reviewer notes through participant, staff, search, export, or nested purchase endpoints.
2. **Whole-purchase payment semantics.** One order can contain multiple event lines; a payment decision applies to that entire order. The review UI must display this clearly.
3. **Durable paid state.** Ticket fulfillment is recoverable work. A ticket generation failure never reverses an approved payment or marks the purchase unpaid.
4. **Safe account linking.** Never allow a password registration to claim an existing Google/pre-provisioned staff account by email alone. Require verified control and a deliberate linking/recovery flow.
5. **No race-prone IDs.** Use database sequences/identity or collision-safe retry for human-readable purchase/ticket references; never `MAX(id)+1` without a serialized allocator.
6. **Capacity correctness.** Capacity units are explicit (`SEATS`, `TEAMS`, `ENTRIES`); null capacity means unlimited. Multi-event checkout is all-or-nothing; reservations are tracked and released exactly once.
7. **Payment-submitted reservation behavior.** Do not expire/release inventory underneath a submitted payment awaiting review. Define a finite rejection/resubmission policy.
8. **Dynamic forms fail closed.** Invalid schema must not skip validation. Validate field IDs, types, options, lengths, numeric bounds, dates, required fields, and response scope against the exact published version.
9. **Per-attendee ticketing.** Team purchases issue one ticket per confirmed attendee registration, not just one ticket to the leader.
10. **Correct roster joins.** Staff roster must derive ticket/check-in state per attendee registration/beneficiary, not assume all team members are the leader's registration.
11. **E-sports isolation.** Only E_SPORTS events can score; validate match and participant event scope; history required for changes and finalization overrides.
12. **Auditability.** Append-only application audit/history for role and assignment changes, protected event changes, purchase/payment state, ticket lifecycle, check-in/reversal, and score changes.
13. **Seed integrity.** Preserve all 46 event records and meaningful fields; explicitly map festival day, category, format, fee model, capacity, and price in paise. Dry-run first, idempotent import, no secret files.
14. **Frontend independence.** Use the new API contract and publish OpenAPI. Do not preserve old route names solely for compatibility.

## Required end-to-end acceptance scenarios

- New participant registers, logs in, completes profile, creates/joins team, and views their own data only.
- Participant reserves multiple event lines; a capacity conflict in one line rolls back the entire order.
- Duplicate idempotency key + same request returns the same result; same key + different request returns `IDEMPOTENCY_KEY_REUSED`.
- Free purchase confirms registrations and tickets without a payment submission.
- Paid purchase receives UTR; only Super Admin can see evidence and approve/reject/hold it.
- Approving a multi-event purchase confirms all eligible registrations; a retry does not duplicate tickets.
- Ticket fulfillment failure keeps purchase paid and is retried successfully.
- Event lead can see full roster only for assigned events and edit only descriptive fields.
- Volunteer can scan and view reduced roster but cannot see contact data or payment evidence.
- Two concurrent check-ins for one QR yield exactly one accepted admission.
- Rotating QR invalidates the previous version; revoked tickets cannot check in.
- Malformed form schema/response is rejected rather than bypassed.
- E-sports result correction creates history; non-E_SPORTS scoring requests are rejected.
- Deactivated user/revoked assignment loses access immediately.
- Admin override, payment decision, roster mutation, and check-in correction all produce audit history.

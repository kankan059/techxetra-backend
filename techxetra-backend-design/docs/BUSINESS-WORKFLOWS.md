# Business Workflows and State Transitions

This document is the operational contract. Implement these as domain services with database transactions and tests, not as scattered route-handler conditionals.

## 1. Identity and authorization
1. Public registration always creates `PARTICIPANT`; only Super Admin can assign global staff roles.
2. Staff users must have an active per-event assignment. A global `EVENT_LEAD` or `VOLUNTEER` role alone grants no access to an event.
3. Resolve authorization from the authenticated session and database. Never trust role, owner ID, reviewer ID, price, status, or event scope supplied by the client.
4. Linking Google/password identities requires proof of control of both identities or a verified recovery flow. Matching email by itself is not enough to claim a pre-existing staff/user account.
5. Passwords use Argon2id. Sessions store only token hashes, use HttpOnly/Secure/SameSite cookies, rotate on authentication/security changes, and support revocation. Cookie-authenticated state changes need CSRF protection.

## 2. Event lifecycle
Recommended allowed transitions:
- `DRAFT -> OPEN` only after required public fields, dates, price, capacity/team rules, and form schema validate.
- `OPEN -> CLOSED` manually or when registration close time passes.
- `CLOSED -> OPEN` only by Super Admin if capacity and schedule policy allow.
- `CLOSED -> COMPLETED` after event completion.
- `DRAFT|OPEN|CLOSED -> CANCELLED` by Super Admin with explicit handling for existing reservations, approved purchases, tickets, and participant notification.
- `COMPLETED` and `CANCELLED` are terminal by default; reopening requires explicit admin override and audit.
Public list/detail must not expose drafts. A public registration can be reserved only while event is OPEN, before the close timestamp, and while capacity remains.

Event Leads can edit descriptive/public metadata only; those edits cannot change price, capacity, event category/format, team constraints, status, staff assignments, scoring permissions, payment state, or tickets. Super Admin can change protected configuration with validation and audit. Changes affecting existing orders should not retroactively alter purchase snapshots.

## 3. Dynamic registration forms
- Schema is versioned and immutable after publication. Editing creates a new version.
- Every response stores the exact `form_version_id` used.
- Each field has stable ID, label, type, required flag, and applicable bounds/options. Supported minimum types: `shortText`, `longText`, `number`, `singleChoice`, `multipleChoice`, `checkbox`, `date`, `email`, `phone`.
- Server validates unknown field IDs, required values, types, max/min lengths, numeric bounds, allowed options, date formats, and unexpected keys. Malformed schema is an admin configuration error, not a reason to skip validation.
- Decide whether a field is participant-level or team-level explicitly. Participant-level answers are stored per attendee registration. Team-level answers use a separate team response object/table tied to form version. Do not reuse leader's answers as every member's personal answers.

## 4. Team creation and membership
- A team belongs to one event. Event must allow team registration.
- Leader creates team and invitations; invitee accepts through an authenticated account or a secure email-bound invitation. Invites expire and are single-use.
- A user cannot accept an invite for an email they do not control. Normalize email case-insensitively.
- Enforce event min/max roster sizes before checkout; if policy permits reservation while roster incomplete, do not confirm/charge until roster requirements are satisfied.
- Team member list and leader relationship must remain consistent. A leader is also an attendee/member if event attendance requires it.
- Once checkout reservation is created, freeze the roster for that purchase. Cancellation/expiry unlocks roster only if no paid/confirmed registration exists.
- Do not allow duplicate active registration for same event+participant, multiple active team memberships in same event where prohibited, or duplicate team names among active teams.
- If an accepted member is not eligible or does not have a required account/profile, reject checkout with a clear field-level error.

## 5. Purchase and capacity reservation
Purchase creation must be a single transaction:
1. Validate authenticated buyer and idempotency key/request hash.
2. Load events, prices, student pricing eligibility, registration windows, published form versions, and team rosters from DB.
3. Reject duplicate items and mismatches; compute amount entirely server-side in paise.
4. Lock affected event rows in deterministic sorted order (or equivalent robust concurrency mechanism).
5. Verify capacity using the configured unit (`SEATS`, `TEAMS`, or `ENTRIES`) and active reservations + confirmed registrations.
6. Create purchase and line-item snapshots, reserved registrations for every intended attendee, form responses, and reservation expiry (15 minutes default).
7. Commit all records together. If any line fails, roll back the whole purchase and all capacity effects.
8. If total is zero, mark purchase `PAID` with payment method `FREE`, confirm registrations, and enqueue ticket fulfillment. Free orders do not need UPI review.

Do not decrement a counter without recording which reservation owns that capacity. A counter can be used as an optimization only if transactionally maintained and reconciled. A multi-event order either reserves all lines or none.

## 6. Reservation expiry and cancellation
- Default reservation TTL is 15 minutes, configurable.
- Expiry worker/job processes expired unpaid purchases in batches using row locking/`SKIP LOCKED` or equivalent.
- Only unpaid `AWAITING_PAYMENT` purchases may expire. A submitted payment awaiting review must not auto-expire and release inventory while admin review is pending; instead the submission keeps the purchase reserved or moves it to a clearly defined manual-review state. Document and test this policy.
- Expiry/cancellation releases capacity exactly once, marks reserved registrations expired/cancelled, and unlocks a team roster only when safe.
- A paid purchase cannot be cancelled by participant through the unpaid cancellation endpoint.

## 7. Manual UPI payment (single purchase-level payment)
1. Participant submits UTR and optionally evidence for one purchase. Normalize UTR (trim/uppercase/remove permitted whitespace) and validate expected length/characters. Reject duplicates according to the UTR policy.
2. Store evidence privately with content-type, size, file signature checks, random object key, and access control. Never use a public URL or trust client MIME alone.
3. Set payment submission to `SUBMITTED`, purchase to `PENDING_VERIFICATION`; record event time and notify admin queue if notifications are implemented.
4. Only Super Admin may view sensitive evidence, UTR, private notes, and make a decision. Event leads and volunteers cannot review payments.
5. Admin chooses `APPROVED`, `REJECTED`, or `ON_HOLD`; decision is idempotent, transactional, and appended to `payment_review_history` and `audit_logs`. Reviewer ID comes from session.
6. Approval applies to the entire purchase and all items. In one transaction: lock purchase/submission; ensure not already decided inconsistently; mark submission approved and purchase paid; confirm all reserved registrations; set `paid_at`; enqueue fulfillment. Repeated identical approval returns the prior result; conflicting second decision returns `PAYMENT_ALREADY_REVIEWED`.
7. Rejection leaves registrations reserved only for a documented grace period/resubmission flow or releases reservation immediately according to a documented policy. Do not leave ambiguous indefinite holds. The participant must see rejection status and a safe next step.
8. Hold keeps purchase in review and inventory reservation policy explicit. A hold cannot silently create tickets.
9. Ticket fulfillment is separate/recoverable. If ticket generation fails after approval, do not reverse the paid state. Mark fulfillment retry required and allow idempotent retry. Admin can inspect failures.
10. Do not expose UTR, evidence, or reviewer note in staff participant APIs, logs, or exports.

## 8. Ticket fulfillment and QR
- Issue one ticket per confirmed attendee registration, not one per team leader.
- Unique constraint on `tickets.registration_id` prevents duplicate tickets. Fulfillment can be retried safely.
- Generate `public_id` using a collision-safe sequence/retry (example human reference `TX26XXXX`); never use `MAX(existing_id)+1` without locking/sequence.
- QR payload `tx1.<ticket-id>.<version>.<hmac>`. Sign canonical ticket ID/version with HMAC-SHA256 and constant-time compare. Store HMAC key in secret environment/secret manager. Do not include personal data.
- Rotating QR increments `qr_version`, invalidating old QR. Revoked/void tickets cannot be admitted.

## 9. Atomic check-in
- Lookup verifies signature, ticket existence, version, status, event scope, event schedule/policy, and staff assignment but does not consume the ticket.
- Check-in repeats validation inside a transaction and locks ticket row or performs conditional `UPDATE ... WHERE status='ACTIVE' AND used_at IS NULL AND qr_version=? RETURNING ...`.
- Only one concurrent request may return `ACCEPTED`; others return `ALREADY_USED` (or a clear invalid outcome if revoked/rotated concurrently).
- Record every scan outcome with scanner, event, timestamp, request ID and outcome. Avoid storing QR signature or unnecessary PII.
- Super Admin may undo a check-in only with reason and audit; never delete the original record. Use a correction/reversal record.

## 10. Staff roster privacy and scope
- `EVENT_LEAD`: event-scoped access to detailed operational attendee data (including participant contact/profile details and relevant form answers) to manage their assigned event. No payment evidence, UTR, reviewer note, or payment decision routes.
- `VOLUNTEER`: event-scoped minimal roster, name, team, registration status, ticket status, check-in state, and only operational form fields required for on-site execution. Hide email/phone/institution ID and private form fields by default.
- Staff only sees assigned events; every detail, search, export, and nested relation must enforce scope in the backend query/service, not just by filtering the UI.
- Admin assignment changes are audited. Revoked assignments take effect immediately.

## 11. E-sports scoring
- Only `E_SPORTS` events may have scoring enabled.
- Match participants must be confirmed registrations for the same event. A registration/team cannot be placed into conflicting matches in the same round unless format explicitly permits it.
- Result write/correction records actor, before/after, reason and time. Finalized results are immutable to ordinary scorers; reopening requires lead/admin permission and reason.
- Public leaderboard is returned only when event enables it and policy permits publication. Define deterministic tie-break rules in `docs/DECISIONS.md` and tests. Do not show incomplete rounds as final standings.

## 12. Audit, idempotency, and errors
- Audit event creation/config changes, staff assignment, role changes, auth/session security changes, team roster changes, purchase/cancel/expiry, payment submission/decision, fulfillment retry, ticket issue/revoke/rotate, check-in/reversal, and score correction/finalization.
- full QR signatures, raw session tokens, or unnecessary sensitive payment information.
- Require idempotency for purchase create, payment submission, payment decision, fulfillment retry, and check-in where client retries are possible. Reusing a key with a different request hash returns `IDEMPOTENCY_KEY_REUSED`.
- Use typed domain errors mapped to stable HTTP status/error codes. Expected business conflicts are not 500 errors.

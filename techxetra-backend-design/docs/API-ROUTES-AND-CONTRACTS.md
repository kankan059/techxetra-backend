# API Routes and Request/Response Contracts

Base path: `/api/v1`. All API routes return JSON. Do not introduce file upload or download endpoints unless explicitly approved by the project owner. Use `camelCase` in JSON, ISO-8601 timestamps, UUIDs for internal IDs, and public IDs where helpful. Route names are a new contract; frontend can be adapted later. This registry is the minimum expected API. Extra routes are allowed when needed, but do not omit these workflows.

## 1. Response envelope and errors

Success:
```json
{
  "data": { "id": "uuid", "example": "value" },
  "meta": { "requestId": "req_..." }
}
```
Paginated list:
```json
{
  "data": [],
  "meta": { "requestId": "req_...", "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
}
```
Error:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Invalid email address" }]
  },
  "meta": { "requestId": "req_..." }
}
```
Never return stack traces in production. Stable error codes include `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `EVENT_NOT_OPEN`, `CAPACITY_EXCEEDED`, `RESERVATION_EXPIRED`, `INVALID_STATE_TRANSITION`, `PAYMENT_ALREADY_REVIEWED`, `DUPLICATE_UTR`, `TICKET_INVALID`, `TICKET_ALREADY_USED`, `WRONG_EVENT`, `IDEMPOTENCY_KEY_REUSED`, `INTERNAL_ERROR`.

Use query params `page` (default 1), `pageSize` (default 20, max 100), documented sort keys, and allowlisted filters. Do not expose raw ORM objects. Use `Idempotency-Key` for purchase creation, payment submission where appropriate, admin review actions, and ticket check-in requests.

## 2. Public and health routes

| Method + path | Access | Purpose |
|---|---|---|
| `GET /health` | Public | Process health only |
| `GET /ready` | Public | Database readiness; no secrets |
| `GET /festival` | Public | Public festival settings and festival days |
| `GET /events` | Public | Filterable event list |
| `GET /events/:eventIdOrSlug` | Public | Public event detail + published form schema |
| `GET /events/:eventIdOrSlug/leaderboard` | Public if enabled | Public e-sports leaderboard |

`GET /events` query: `category?`, `day?`, `status?` (public output must never reveal draft events), `q?`, `page?`, `pageSize?`, `sort?`. Response event card: `id`, `slug`, `title`, `category`, `format`, `shortDescription`, `venue`, `festivalDay`, `startsAt`, `endsAt`, `status`, `priceModel`, `pricePaise`, `studentPricePaise`, `capacityUnit`, `availableCapacity` (nullable for unlimited), `minTeamSize`, `maxTeamSize`, `scoringEnabled`.

`GET /events/:idOrSlug` adds `description`, `rules`, `organizer`, `eligibility`, `timeline`, `prizes`, registration window, and currently published form schema/version. Never return private event metadata or internal payment details.

Example:
```json
{
  "data": {
    "id": "uuid",
    "slug": "robotics-challenge",
    "title": "Robotics Challenge",
    "category": "TECHNICAL",
    "format": "TEAM",
    "status": "OPEN",
    "priceModel": "PER_TEAM",
    "pricePaise": 50000,
    "capacity": 24,
    "capacityUnit": "TEAMS",
    "availableCapacity": 7,
    "minTeamSize": 2,
    "maxTeamSize": 4,
    "form": { "version": 2, "schema": [] }
  },
  "meta": { "requestId": "req_example" }
}
```

## 3. Authentication and profile

| Method + path | Access | Purpose |
|---|---|---|
| `POST /auth/register` | Public, rate-limited | Email/password account creation |
| `POST /auth/login` | Public, rate-limited | Email/password login |
| `POST /auth/google` | Public, rate-limited | Verify Google ID token and sign in/up |
| `POST /auth/logout` | Public/session if present | Revoke session and clear cookie |
| `GET /auth/session` | Authenticated | Current identity and session status |
| `POST /auth/forgot-password` | Public, rate-limited | Start recovery; response must not reveal account existence |
| `POST /auth/reset-password` | Public, token | Consume one-time recovery token |
| `POST /auth/verify-email` | Public, token | Verify email |
| `GET /me` | Authenticated | Current profile |
| `PATCH /me` | Authenticated | Update allowed profile fields |
| `GET /me/registrations` | Participant | Own registrations |
| `GET /me/teams` | Participant | Own teams/memberships |
| `GET /me/purchases` | Participant | Own purchase list |
| `GET /me/tickets` | Participant | Own tickets |

Register request: `{ "email": "user@example.com", "password": "...", "displayName": "..." }`. Never accept `role`, `isActive`, student-field lock, or verification status from public input. Response: `201` with safe user profile and set-cookie session.

Login request: `{ "email": "user@example.com", "password": "..." }`. Response: `{ "data": { "user": { "id", "email", "displayName", "role", "profileCompletedAt" } } }` and secure HttpOnly cookie. Avoid different error messages for unknown email vs wrong password.

Profile PATCH allows only `displayName`, `phone`, `institutionName`, `institutionId`, `isStudent`, and avatar field if supported. Student/institution fields locked by admin policy cannot be changed by the participant. Never return password hashes, raw session tokens, provider tokens, or security internals.

## 4. Teams and invitations

| Method + path | Access | Purpose |
|---|---|---|
| `POST /teams` | Participant | Create event-specific team |
| `GET /teams/:teamId` | Team member/leader | Team details and roster |
| `PATCH /teams/:teamId` | Team leader | Rename team while editable |
| `DELETE /teams/:teamId` | Team leader, draft only | Disband/cancel team |
| `POST /teams/:teamId/invitations` | Team leader | Invite member by email |
| `GET /team-invitations/mine` | Authenticated | Pending invitations for current user/email |
| `POST /team-invitations/:invitationId/accept` | Invitee | Accept invitation |
| `POST /team-invitations/:invitationId/decline` | Invitee | Decline invitation |
| `DELETE /teams/:teamId/members/:memberId` | Team leader; member may leave | Remove member/leave team where allowed |

Create team request: `{ "eventId": "uuid", "name": "Team Orion" }`. Invitation request: `{ "email": "member@example.com" }`. Accept/decline request has no body. Enforce event format, roster limits, one active team membership per user/event where applicable, leader rules, invitation expiry, and lock rules on the server. A team may not change its roster after a purchase reservation locks it unless the reservation is cancelled/expired and the policy permits edits.

## 5. Purchases and registrations

| Method + path | Access | Purpose |
|---|---|---|
| `POST /purchases` | Participant | Create order and atomically reserve capacity |
| `GET /purchases/:purchaseId` | Buyer or Super Admin | Purchase details; staff access must not expose payment evidence |
| `POST /purchases/:purchaseId/cancel` | Buyer, unpaid only | Cancel reservation |
| `GET /purchases/:purchaseId/payment` | Buyer | Own payment status and UPI instructions |
| `POST /purchases/:purchaseId/payment-submissions` | Buyer, active reservation | Submit UTR and optional evidence metadata/file reference |
| `POST /purchases/:purchaseId/payment-submissions/:submissionId/withdraw` | Buyer, if policy allows and not reviewed | Withdraw submission |

Purchase request shape:
```json
{
  "items": [
    { "eventId": "event-uuid", "participantUserId": "current-user-uuid", "formResponse": { "field_id": "answer" } },
    { "eventId": "team-event-uuid", "teamId": "team-uuid", "formResponse": { "field_id": "answer" } }
  ]
}
```
The exact request schema should be refined in implementation to clearly represent individual vs team lines and each beneficiary. The server derives prices, student eligibility, event state, team roster, form version, capacity, and totals from the database. It must reject unknown fields, duplicates, mismatched event/team, unaccepted members, stale form versions, closed registration windows, and invalid quantities. For team events, create a registration for every intended attendee, not just the leader.

Purchase response includes `id`, `publicId`, `status`, `subtotalPaise`, `totalAmountPaise`, `reservationExpiresAt`, `items[]` with event snapshot/quantity/line total, `paymentStatus` sanitized for buyer, and `nextAction`. Do not include internal DB columns or other users' private profile data.

Payment submission request:
```json
{ "utr": "ABC123456789", "submittedAmountPaise": 50000 }
```
Participants submit the UPI transaction ID/UTR for a purchase.
The server normalizes the transaction ID, validates the request, and
prevents the same transaction ID from being used for multiple purchases.

The response contains the submission ID, payment status, submission
timestamp, and purchase status as appropriate. Do not accept a
client-provided amount as proof of payment. Do not implement payment
screenshots, evidence uploads, evidence downloads, or evidence storage.

Only a Super Admin can review the submitted transaction ID against
the actual UPI payment records and approve, reject, or hold the
purchase payment.

## 6. Super Admin payment review (only)

| Method + path | Access | Purpose |
|---|---|---|
| `GET /admin/payments` | Super Admin | Filterable review queue |
| `GET /admin/payments/:submissionId` | Super Admin | Full submission detail and private evidence access |
| `POST /admin/payments/:submissionId/decision` | Super Admin | Approve, reject, or hold |

Decision request:
```json
{ "decision": "APPROVED", "reasonCode": "UTR_MATCHED", "privateNote": "Reference matched bank statement" }
```
`decision` must be `APPROVED`, `REJECTED`, or `ON_HOLD`. Require an idempotency key and audit reviewer, timestamp, decision, and reason. Approval applies to the entire purchase/order and all its line items; the UI/API must make this explicit. It must atomically mark payment approved and purchase paid, confirm registrations, and schedule ticket fulfillment. If fulfillment fails, payment remains approved/paid and a recoverable retry is created. Rejection/hold must have documented resubmission behavior. Event leads and volunteers must not have these routes and must not receive evidence/UTR/reviewer notes from any other endpoint.

## 7. Tickets and admission

| Method + path | Access | Purpose |
|---|---|---|
| `GET /tickets/:ticketId` | Ticket owner or Super Admin | Ticket detail; QR only to owner/admin as appropriate |
| `POST /staff/scan/lookup` | Assigned Volunteer/Lead/Super Admin | Validate QR without consuming ticket |
| `POST /staff/scan/check-in` | Assigned Volunteer/Lead/Super Admin | Atomic one-time admission |
| `GET /staff/events/:eventId/check-ins` | Assigned staff, scoped | Operational check-in log, privacy-filtered |
| `POST /admin/tickets/:ticketId/revoke` | Super Admin | Revoke ticket |
| `POST /admin/tickets/:ticketId/rotate-qr` | Super Admin | Increment QR version / invalidate old QR |
| `POST /admin/tickets/:ticketId/undo-check-in` | Super Admin, reason required | Controlled correction with audit |

Lookup request: `{ "qrPayload": "tx1.<ticket-id>.<version>.<signature>", "eventId": "uuid" }`. Check-in request has same payload plus optional `deviceId`. QR format must be signed server-side using HMAC secret; do not put PII in QR. Lookup is non-consuming. Check-in is atomic and single-use. Return structured outcomes (`ACCEPTED`, `ALREADY_USED`, `INVALID`, `REVOKED`, `WRONG_EVENT`, `NOT_YET_VALID`, `EVENT_CLOSED`) and a minimal attendee summary. Volunteers see minimal fields; event leads see full operational fields for their assigned event. The client must never decide whether admission succeeded.

## 8. Staff event operations

| Method + path | Access | Purpose |
|---|---|---|
| `GET /staff/events` | Assigned staff | Current user's assigned events |
| `GET /staff/events/:eventId/dashboard` | Assigned staff | Event summary, counts, check-in status |
| `GET /staff/events/:eventId/participants` | Assigned staff | Paginated, privacy-tiered roster |
| `PATCH /staff/events/:eventId/public-details` | Assigned Event Lead only | Update allowed descriptive fields |
| `GET /staff/events/:eventId/registrations/:registrationId` | Assigned staff | Scoped registration detail, privacy-tiered |
| `GET /staff/events/:eventId/leaderboard` | Assigned staff; public route may also exist | Event scoring view |

Event Lead editable fields: `title`, `shortDescription`, `description`, `rules`, `venue`, `organizer`, `eligibility`, `timeline`, `prizes`, `publicInstructions`. Reject or ignore? Prefer reject with `FIELD_NOT_ALLOWED` if request includes protected fields like price, capacity, category, format, team size, status, staff assignment, payment state, ticket state, or scoring permission. Volunteer cannot edit event configuration.

Participant DTO for Event Lead may include display name, email, phone, institution/student fields, team/registration details, validated form answers, payment/registration status in sanitized form, ticket/check-in state. Volunteer DTO should default to display name, team name, registration state, ticket state, check-in state, and only operational form answers; do not include email, phone, institution ID, UTR, evidence, reviewer notes, or payment decision controls. Every request must check active assignment for the specific event.

## 9. E-sports scoring

| Method + path | Access | Purpose |
|---|---|---|
| `GET /staff/events/:eventId/matches` | Assigned staff | Matches/rounds |
| `POST /staff/events/:eventId/matches` | Assigned lead or authorized scorer | Create match/round as permitted |
| `PUT /staff/events/:eventId/matches/:matchId/result` | Assigned lead or authorized scorer | Record/correct result |
| `POST /staff/events/:eventId/scoring/finalize` | Event Lead or Super Admin | Finalize leaderboard |
| `POST /staff/events/:eventId/scoring/reopen` | Event Lead or Super Admin, reason required | Reopen with audit |
| `GET /events/:eventId/leaderboard` | Public only if enabled | Published leaderboard |

Scoring routes must reject non-`E_SPORTS` events and verify match belongs to route event. Result corrections create history with before/after and reason. Do not publish incomplete/unfinalized standings unless event policy explicitly allows it.

## 10. Super Admin management

| Method + path | Access | Purpose |
|---|---|---|
| `GET /admin/users` | Super Admin | Search/list users |
| `PATCH /admin/users/:userId` | Super Admin | Activate/deactivate, role change, permitted profile correction |
| `GET /admin/events` | Super Admin | All events including drafts |
| `POST /admin/events` | Super Admin | Create event and first form version if supplied |
| `PATCH /admin/events/:eventId` | Super Admin | Full event configuration with validation |
| `POST /admin/events/:eventId/publish` | Super Admin | Validate and publish/open event |
| `POST /admin/events/:eventId/cancel` | Super Admin | Cancel event with policy for affected orders |
| `GET /admin/events/:eventId/staff` | Super Admin | Assignments |
| `PUT /admin/events/:eventId/staff/:userId` | Super Admin | Assign/update staff role for event |
| `DELETE /admin/events/:eventId/staff/:userId` | Super Admin | Revoke assignment |
| `PUT /admin/events/:eventId/form-schema` | Super Admin | Create new immutable schema version |
| `GET /admin/purchases` | Super Admin | Purchase search/supervision |
| `GET /admin/purchases/:purchaseId` | Super Admin | Full purchase detail |
| `POST /admin/purchases/:purchaseId/retry-fulfillment` | Super Admin | Retry failed fulfillment idempotently |
| `GET /admin/registrations` | Super Admin | Registration search |
| `POST /admin/registrations/:registrationId/cancel` | Super Admin | Cancel with reason/policy |
| `GET /admin/reports/summary` | Super Admin | Platform summary |
| `GET /admin/reports/financial` | Super Admin | Payment/finance summary |
| `GET /admin/reports/attendance` | Super Admin | Check-in/attendance summary |
| `GET /admin/audit-logs` | Super Admin | Filterable audit history |
| `PATCH /admin/settings/:key` | Super Admin | Public operational setting only |
| `PUT /admin/festival-days/:dayNumber` | Super Admin | Festival-day configuration |

Every admin mutation requires input validation, authorization, audit log, and explicit state-transition checks. Do not hard-delete records with financial/admission history.

## 11. OpenAPI and test contract
- Every route above must appear in generated/maintained OpenAPI.
- Document required role, event scope, request schema, response schema, error codes, and idempotency behavior.
- Add contract tests for every route family and authorization boundary.
- Do not expose internal reviewer notes or evidence to staff through search, report, nested purchase objects, logs, or exports.

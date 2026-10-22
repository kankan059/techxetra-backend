> REFERENCE STATUS: This document describes the previous implementation and is retained only as a domain/capability checklist. It is NOT the target runtime, schema, route contract, or authority when it conflicts with `docs/` or `GREENFIELD-BACKEND-SPEC.md`. Do not implement Hono, Workers, D1, SQLite, Wrangler, or old implementation-specific details from this file. Latest decisions in `docs/DECISIONS-AND-OPEN-CHOICES.md` supersede conflicting staff-payment, auth, privacy, concurrency, and schema behavior.

# 02 — Routes and Endpoints Registry

This document catalogues all 24 route controllers in `src/routes/`, detailing HTTP methods, URL paths, middleware guards, input validation schemas, execution logic, database effects, and error codes.

---

## 🗺️ Route Index

```
Public & Health
├── /health                               -> health.ts
├── /ready                                -> health.ts
├── /api/catalog/passes                   -> catalog.ts
├── /api/events                           -> events.ts
├── /api/events/:idOrSlug                 -> events.ts
└── /api/leaderboards/:eventId            -> leaderboards.ts

Authentication & Profile
├── /api/auth/google                      -> auth.ts
├── /api/auth/register                    -> auth.ts
├── /api/auth/login                       -> auth.ts
├── /api/auth/logout                      -> auth.ts
├── /api/auth/session                     -> auth.ts
├── /api/me                               -> me.ts (GET & PATCH)

Participant Features
├── /api/teams                            -> teams.ts (POST, GET /mine, GET /:id, DELETE /:id)
├── /api/teams/:id/invite                 -> teams.ts (POST)
├── /api/teams/:id/members/:memberId      -> teams.ts (DELETE)
├── /api/team-invites                     -> team-invites.ts (GET /mine, POST /:id/accept, POST /:id/decline)
├── /api/purchases                        -> purchases.ts (POST, GET /mine, GET /:id, POST /:id/cancel)
├── /api/purchases/:id/payment            -> payments.ts (GET, POST submit UTR, POST withdraw)
├── /api/tickets                          -> tickets.ts (GET /mine, GET /:id)
└── /api/registrations/mine               -> registrations.ts (GET)

Staff Portal (Volunteer, Lead & Committee)
├── /api/staff/scan/lookup                -> staff-scan.ts (POST)
├── /api/staff/scan/admit                 -> staff-scan.ts (POST)
├── /api/staff/events/mine                -> staff-events.ts (GET)
├── /api/staff/events/:id/dashboard       -> staff-events.ts (GET)
├── /api/staff/events/:id/registrations   -> staff-events.ts (GET)
├── /api/staff/events/:id/payments        -> staff-events.ts (GET)
├── /api/staff/events/:id/payments/:pid/review -> staff-events.ts (POST)
├── /api/staff/events/:id                 -> staff-events.ts (PATCH)
├── /api/staff/events/:id/scores          -> staff-esports.ts (POST)
├── /api/staff/events/:id/scores/:scoreId -> staff-esports.ts (DELETE)
├── /api/staff/events/:id/finalize        -> staff-esports.ts (POST)
└── /api/staff/events/:id/reopen          -> staff-esports.ts (POST)

Admin Portal (Reviewer & Super Admin)
├── /api/admin/users                      -> admin-users.ts (GET, PATCH /:id)
├── /api/admin/events                     -> admin-events.ts (POST, PATCH /:id, DELETE /:id)
├── /api/admin/events/:id/staff           -> admin-events.ts (GET, POST, DELETE /:userId)
├── /api/admin/payments                   -> admin-payments.ts (GET queue, GET /:id, POST /:id/review)
├── /api/admin/purchases                  -> admin-purchases.ts (GET, GET /:id, POST /:id/retry-fulfillment)
├── /api/admin/tickets                    -> admin-tickets.ts (POST revoke, reissue, rotate-qr, undo-checkin)
├── /api/admin/registrations              -> admin-registrations.ts (GET, POST /:id/cancel)
├── /api/admin/reports                    -> admin-reports.ts (GET /summary, /financial, /attendance)
├── /api/admin/audit-logs                 -> admin-audit.ts (GET)
├── /api/admin/settings                   -> admin-settings.ts (PATCH)
└── /api/admin/fest-days/:dayNumber       -> admin-settings.ts (PATCH)
```

---

## 1. Health & Readiness (`src/routes/health.ts`)

Mounted at `/` and `/api`.

### 1.1 Root Status
- **Method / Path**: `GET /` and `GET /api`
- **Auth**: None (Public)
- **Logic**: Returns static healthy status and ISO 8601 server timestamp.
- **Response**: `200 OK` `{ status: "healthy", timestamp: string }`

### 1.2 Ping Health
- **Method / Path**: `GET /health` and `GET /api/health`
- **Auth**: None (Public)
- **Response**: `200 OK` `{ status: "ok" }`

### 1.3 Readiness Check
- **Method / Path**: `GET /ready` and `GET /api/ready`
- **Auth**: None (Public)
- **Logic**: Executes `SELECT 1` against Cloudflare D1.
- **Errors**: `503 Service Unavailable` with `DATABASE_UNAVAILABLE` if query fails.
- **Response**: `200 OK` `{ status: "ready", database: "connected" }`

---

## 2. Authentication (`src/routes/auth.ts`)

Mounted at `/api/auth`.

### 2.1 Google OAuth Login / Signup
- **Method / Path**: `POST /api/auth/google`
- **Auth**: None
- **Schema**: `{ id_token: string }`
- **Logic**:
  1. Validates Google JWT signature against Google JWKS (or test key in test environment).
  2. Extracts `sub`, `email`, `name`, `picture`.
  3. Finds user by `google_sub` or links existing user by `email` (rejecting if `google_sub` conflicts).
  4. If new, creates user record with `role: 'PARTICIPANT'`. Automatically binds any pending team invites with matching email to `user_id`.
  5. Issues session token (SHA-256 stored in D1) and returns `Set-Cookie` header (`__Host-session` or `session`).
- **Response**: `200 OK` with user profile and session info.

### 2.2 Register with Email / Password
- **Method / Path**: `POST /api/auth/register`
- **Auth**: None
- **Schema**: `{ email: string, password: string (>= 8 chars), name: string }`
- **Logic**:
  1. Normalizes email.
  2. If user exists with password, throws `409 EMAIL_ALREADY_EXISTS`.
  3. If user exists without password (e.g. pre-registered staff or Google user), updates `password_hash`.
  4. If user does not exist, generates UUID and hashes password using PBKDF2-SHA256 (100,000 iterations).
  5. Inserts user, links pending team invites, creates session, and attaches session cookie.
- **Response**: `201 Created` with formatted user profile.

### 2.3 Login with Email / Password
- **Method / Path**: `POST /api/auth/login`
- **Auth**: None
- **Schema**: `{ email: string, password: string }`
- **Logic**:
  1. Normalizes email and fetches user.
  2. If user missing, deactivated, or lacks password hash, throws `401 INVALID_CREDENTIALS` or `403 ACCOUNT_DISABLED`.
  3. Verifies PBKDF2 hash using constant-time equality.
  4. Creates session and attaches session cookie.
- **Response**: `200 OK` with user profile.

### 2.4 Logout
- **Method / Path**: `POST /api/auth/logout`
- **Auth**: None (clears cookie even if unauthenticated)
- **Logic**: Extracts session token from cookie, sets `revoked_at = now` in D1, and returns an expired `Set-Cookie` header.
- **Response**: `200 OK` `{ message: "Logged out successfully" }`

### 2.5 Current Session Check
- **Method / Path**: `GET /api/auth/session`
- **Auth**: `requireAuth()`
- **Logic**: Validates session cookie in D1, updates sliding window if `PARTICIPANT`, returns active session and user profile.
- **Response**: `200 OK` `{ authenticated: true, user: FormattedUserProfile }`

---

## 3. User Profile (`src/routes/me.ts`)

Mounted at `/api/me`.

### 3.1 Get My Profile
- **Method / Path**: `GET /api/me`
- **Auth**: `requireAuth()`
- **Logic**: Returns formatted profile including computed `profile_complete: boolean` and `missing_fields: string[]`.
- **Response**: `200 OK` `FormattedUserProfile`

### 3.2 Update My Profile
- **Method / Path**: `PATCH /api/me`
- **Auth**: `requireAuth()`
- **Schema**: `{ name?: string (2-100), phone?: string (Indian 10-digit), is_student?: boolean, institution_name?: string | null, institution_id?: string | null }`
- **Logic**:
  1. Checks `user.student_fields_locked === 1`. If locked and request modifies `is_student`, `institution_name`, or `institution_id`, throws `403 STUDENT_FIELDS_LOCKED`.
  2. Normalizes phone to 10 digits (`normalizePhoneNumber`).
  3. Recomputes profile completeness. If complete for the first time, sets `profile_completed_at = now`.
  4. Persists updates to D1 `users` table.
- **Response**: `200 OK` Updated `FormattedUserProfile`.

---

## 4. Catalog, Events & Leaderboards (`catalog.ts`, `events.ts`, `leaderboards.ts`)

### 4.1 Get Festival Passes & Settings
- **Method / Path**: `GET /api/catalog/passes`
- **Auth**: None (Public)
- **File**: [`src/routes/catalog.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/catalog.ts)
- **Logic**: Returns `gate_pass_price_paise`, `gate_pass_student_price_paise`, `purchases_enabled`, `fest_days`, and warning notices.
- **Response**: `200 OK`

### 4.2 List Events
- **Method / Path**: `GET /api/events`
- **Auth**: None (Public)
- **File**: [`src/routes/events.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/events.ts)
- **Query Params**: `category`, `day`, `is_team`, `search`, `cursor`, `limit` (max 50).
- **Logic**: Filters out `status = 'DRAFT'`. Orders by `starts_at ASC, id ASC`. Computes `registration_open` and `seats_remaining`.
- **Response**: `200 OK` `{ events: PublicEventResponse[], next_cursor: string | null }`

### 4.3 Get Single Event
- **Method / Path**: `GET /api/events/:idOrSlug`
- **Auth**: None (Public)
- **File**: [`src/routes/events.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/events.ts)
- **Logic**: Looks up by UUID or unique slug. If `status === 'DRAFT'`, returns `404 NOT_FOUND` unless caller is staff.
- **Response**: `200 OK` `PublicEventResponse`

### 4.4 Get E-Sports Public Leaderboard
- **Method / Path**: `GET /api/leaderboards/:eventId`
- **Auth**: None (Public)
- **File**: [`src/routes/leaderboards.ts`](file:///home/ppriyankuu/Projects/TechXetraWebsite/backend/src/routes/leaderboards.ts)
- **Logic**:
  1. Validates event has `category === 'E_SPORTS'` and `leaderboard_public === 1`.
  2. Aggregates scores across rounds, calculates totals, resolves ties by highest round scores, and assigns ranks.
- **Response**: `200 OK` `{ event: { ... }, leaderboard: LeaderboardEntry[], finalized: boolean }`

---

## 5. Teams & Invitations (`teams.ts`, `team-invites.ts`)

### 5.1 Create Team
- **Method / Path**: `POST /api/teams`
- **Auth**: `requireAuth()`, `requireProfileComplete()`
- **Schema**: `{ event_id: string, name: string (2-50 chars) }`
- **Logic**:
  1. Validates event is team event and registration is open.
  2. Preflight checks: leader not already leading active team; team name not taken for event; leader not already accepted in another team for this event.
  3. Atomic batch: Inserts team (`status: 'DRAFT'`), inserts leader member (`role: 'LEADER', status: 'ACCEPTED'`), creates audit row.
- **Response**: `201 Created` `TeamWithMembers`

### 5.2 Get My Teams
- **Method / Path**: `GET /api/teams/mine`
- **Auth**: `requireAuth()`
- **Logic**: Returns all teams where user is leader or has accepted/pending invite.
- **Response**: `200 OK` `TeamWithMembers[]`

### 5.3 Get Team Details
- **Method / Path**: `GET /api/teams/:id`
- **Auth**: `requireAuth()`
- **Logic**: Returns team and members. If user is not member and not admin/staff, returns `404 NOT_FOUND` to hide team existence.
- **Response**: `200 OK` `TeamWithMembers`

### 5.4 Invite Team Member
- **Method / Path**: `POST /api/teams/:id/invite`
- **Auth**: `requireAuth()`
- **Schema**: `{ email: string }`
- **Logic**:
  1. Caller must be leader of draft team. Team must not be `LOCKED` or `CONFIRMED`.
  2. Checks roster cap: accepted + invited cannot exceed `event.max_team_size`.
  3. Verifies target email is not already invited or member of another active team for this event.
  4. Inserts `team_members` row (`status: 'INVITED'`). If user with email already exists, sets `user_id`.
- **Response**: `200 OK` Updated `TeamWithMembers`.

### 5.5 Respond to Team Invite (Accept / Decline)
- **Method / Path**: `POST /api/team-invites/:memberId/accept` and `POST /api/team-invites/:memberId/decline`
- **Auth**: `requireAuth()`, `requireProfileComplete()` (for accept)
- **Logic (Accept)**:
  1. Invitee email must match caller email.
  2. Team must be in `DRAFT` status and team size not exceeded.
  3. User cannot already belong to another team for this event.
  4. Updates `team_members` row to `ACCEPTED` and sets `responded_at = now`.
- **Response**: `200 OK`

### 5.6 Remove Team Member / Leave Team
- **Method / Path**: `DELETE /api/teams/:id/members/:memberId`
- **Auth**: `requireAuth()`
- **Logic**:
  1. Team must be `DRAFT`.
  2. Leader can remove any member (except self). Non-leader can only remove self (leave).
  3. Updates member status to `REMOVED`.
- **Response**: `200 OK`

### 5.7 Disband Team
- **Method / Path**: `DELETE /api/teams/:id`
- **Auth**: `requireAuth()`
- **Logic**: Caller must be leader. Team must be `DRAFT`. Sets `status = 'CANCELLED'`.
- **Response**: `200 OK`

---

## 6. Purchases & Checkout (`src/routes/purchases.ts`)

Mounted at `/api/purchases`.

### 6.1 Create Purchase Reservation
- **Method / Path**: `POST /api/purchases`
- **Auth**: `requireAuth()`, `requireProfileComplete()`
- **Schema**:
  ```ts
  {
    items: Array<{
      item_type: 'GATE_PASS' | 'EVENT_PASS',
      event_id?: string,
      team_id?: string,
      form_responses?: Record<string, any>
    }>,
    acknowledge_student_id_policy?: boolean,
    idempotency_key?: string
  }
  ```
- **Execution Flow**:
  1. Validates global `purchases_enabled === true`.
  2. Enforces maximum 3 open purchases per buyer.
  3. Auto-cancels any expired `AWAITING_PAYMENT` orders for buyer.
  4. Validates items (max 10 items; max 1 gate pass).
  5. Computes pricing: General vs Student based on profile. If student tier applied, requires `acknowledge_student_id_policy === true`.
  6. **Dynamic Form Questionnaire Validation**: If the event has a configured `form_schema`, parses the schema and checks that every field marked `required: true` has a non-empty, non-null value in `item.form_responses`. If missing, throws `400 VALIDATION_ERROR`.
  7. For team events: validates caller is leader, team size satisfies `min_team_size` and `max_team_size`, all members have completed profiles.
  8. Atomic D1 Batch:
     - Inserts `purchases` row (`AWAITING_PAYMENT`, expires in 15 mins).
     - Inserts `purchase_items` rows.
     - Inserts `registrations` rows (`status: 'RESERVED'`, persisting serialized `form_responses` JSON string).
     - Conditional `UPDATE events SET seats_taken = seats_taken + ? WHERE seats_taken + ? <= capacity`.
     - Appends `guardVerifyRow(...)` to guarantee atomicity and rollback on capacity exhaustion (`409 CAPACITY_FULL`).
     - Sets `teams.status = 'LOCKED'` if team event.
  9. **Special Case (0 Paise / Free)**: If total is ₹0, immediately transitions to `PAID`, marks registrations `CONFIRMED`, fulfills tickets, and sets team to `CONFIRMED`.
- **Response**: `201 Created` Detailed purchase with reservation expiry timestamp.

### 6.2 Get My Purchases
- **Method / Path**: `GET /api/purchases/mine`
- **Auth**: `requireAuth()`
- **Response**: `200 OK` `DetailedPurchase[]`

### 6.3 Get Purchase Details
- **Method / Path**: `GET /api/purchases/:id`
- **Auth**: `requireAuth()`
- **Logic**: Enforces ownership (buyer only, or Super Admin).
- **Response**: `200 OK` `DetailedPurchase`

### 6.4 Cancel Purchase Reservation
- **Method / Path**: `POST /api/purchases/:id/cancel`
- **Auth**: `requireAuth()`
- **Logic**: Can only cancel if status is `AWAITING_PAYMENT`. Releases reserved seats, cancels registrations, unlocks teams back to `DRAFT`.
- **Response**: `200 OK`

---

## 7. Manual UPI Payments (`src/routes/payments.ts`)

Mounted at `/api`.

### 7.1 Get Payment Details & UPI Intent
- **Method / Path**: `GET /api/purchases/:id/payment`
- **Auth**: `requireAuth()`
- **Logic**: Returns `UPI_VPA`, payee name, payable amount in paise, formatted UPI intent string (`upi://pay?...`), and existing submission status.
- **Response**: `200 OK`

### 7.2 Submit UPI Transaction ID (UTR)
- **Method / Path**: `POST /api/purchases/:id/payment`
- **Auth**: `requireAuth()`
- **Schema**: `{ transaction_id: string (8-35 alphanumeric), idempotency_key?: string }`
- **Logic**:
  1. Purchase must be `AWAITING_PAYMENT` and reservation not expired.
  2. Normalizes UTR (uppercase, alphanumeric).
  3. Preflight check: UTR cannot be used in another active payment (`ux_payments_active_utr`).
  4. Atomic Batch:
     - Updates purchase status to `PENDING_VERIFICATION` (clears expiry timer).
     - Inserts `payments` row (`status: 'PENDING'`).
     - Appends `payment_audit_logs` record.
- **Response**: `201 Created`

### 7.3 Withdraw Payment Submission
- **Method / Path**: `POST /api/purchases/:id/payment/withdraw`
- **Auth**: `requireAuth()`
- **Logic**:
  1. Purchase must be `PENDING_VERIFICATION`.
  2. Marks payment as `WITHDRAWN`.
  3. Sets purchase back to `AWAITING_PAYMENT` with a fresh 15-minute reservation timer.
- **Response**: `200 OK`

---

## 8. Digital Tickets & QR Tokens (`src/routes/tickets.ts`)

Mounted at `/api/tickets`.

### 8.1 List My Tickets
- **Method / Path**: `GET /api/tickets/mine`
- **Auth**: `requireAuth()`
- **Logic**: Returns all tickets where caller is beneficiary. Includes signed QR token strings (`tx1.<id>.<ver>.<hmac>`).
- **Response**: `200 OK` `TicketWithToken[]`

### 8.2 Get Single Ticket with QR
- **Method / Path**: `GET /api/tickets/:id`
- **Auth**: `requireAuth()`
- **Logic**: Asserts ownership (beneficiary or Super Admin). Computes HMAC-SHA256 signature and returns ticket details with QR token.
- **Response**: `200 OK` `TicketWithToken`

---

## 9. Volunteer & Staff Scanner (`src/routes/staff-scan.ts`)

Mounted at `/api/staff/scan`.

### 9.1 Lookup Ticket (Pre-admit inspection)
- **Method / Path**: `POST /api/staff/scan/lookup`
- **Auth**: Staff Session (`VOLUNTEER`, `LEAD`, `SUPER_ADMIN`)
- **Schema**: `{ qr_token: string, context: 'GATE' | 'EVENT', event_id?: string }`
- **Logic**:
  1. Verifies HMAC-SHA256 signature in constant time.
  2. Decodes ticket ID and version. Verifies `status === 'ACTIVE'`.
  3. Verifies staff permission:
     - If `GATE`: staff must be in `gate_staff` or Super Admin.
     - If `EVENT`: staff must be assigned to event or Super Admin.
  4. Performs dry-run validity checks:
     - Current timestamp within `valid_from` and `valid_to`.
     - If `EVENT`, checks if already admitted (`ux_checkin_event_once`).
     - If `GATE`, checks if scanned recently (< 15 mins) to flag pass-back warning.
  5. Returns attendee name, tier, photo, and whether physical student ID must be checked.
- **Response**: `200 OK` `{ can_admit: boolean, attendee: { ... }, requires_id_check: boolean, warnings: string[] }`

### 9.2 Admit Attendee (Execute Check-in)
- **Method / Path**: `POST /api/staff/scan/admit`
- **Auth**: Staff Session
- **Schema**: `{ qr_token: string, context: 'GATE' | 'EVENT', event_id?: string, student_id_checked: boolean, client_scan_id?: string }`
- **Logic**:
  1. Verifies HMAC and staff assignment.
  2. If ticket tier is `STUDENT` and `student_id_checked !== true`, throws `400 VALIDATION_ERROR`.
  3. Atomic Batch:
     - Inserts `check_in_logs` row (`verdict: 'ADMITTED'`).
     - If `EVENT`: conditional `UPDATE tickets SET event_checked_in_at = ? WHERE event_checked_in_at IS NULL`.
     - Appends `guardVerifyRow(...)` to prevent double admission.
- **Response**: `200 OK` `{ admitted: true, check_in_id: string }`

---

## 10. Staff E-Sports Tournament Scoring (`src/routes/staff-esports.ts`)

Mounted at `/api/staff/events`.

### 10.1 Record / Update Score
- **Method / Path**: `POST /api/staff/events/:id/scores`
- **Auth**: Staff Session (Assigned event staff or Super Admin)
- **Schema**: `{ registration_id: string, round_no: number, score: number, expected_version?: number }`
- **Logic**:
  1. Event must have `category === 'E_SPORTS'` and `scoring_status === 'OPEN'`.
  2. Volunteer scoring permission check: If volunteer, `event.volunteers_can_score` must be 1.
  3. Optimistic locking: If `expected_version` provided, verifies current score version matches.
  4. Upserts score, increments version, and appends immutable `esports_score_history` entry.
- **Response**: `200 OK`

### 10.2 Finalize / Reopen Event Scoring
- **Method / Path**: `POST /api/staff/events/:id/finalize` and `POST /api/staff/events/:id/reopen`
- **Auth**: Lead or Super Admin Session
- **Logic**: Transitions `scoring_status` between `OPEN` and `FINALIZED`. Creates audit log.
- **Response**: `200 OK`

---

## 11. Event Committee & Staff Portal (`src/routes/staff-events.ts`)

Mounted at `/api/staff/events`.

### 11.1 List My Assigned Events
- **Method / Path**: `GET /api/staff/events/mine`
- **Auth**: Staff Session (`LEAD`, `VOLUNTEER`, or `SUPER_ADMIN`)
- **Logic**: Returns all events assigned to caller with live confirmed registrations count, reserved registrations count, seats remaining, and pending payment count. Super Admin receives all events.
- **Response**: `200 OK` `StaffEventSummary[]`

### 11.2 Event Dashboard
- **Method / Path**: `GET /api/staff/events/:id/dashboard`
- **Auth**: Assigned Staff (`VOLUNTEER` min) or Super Admin
- **Logic**: Aggregates capacity, seats taken, seats remaining, confirmed count, checked-in count, pending payments count, and full assigned staff roster.
- **Response**: `200 OK` `{ event: PublicEventResponse, metrics: { ... }, staff: EventStaffMember[] }`

### 11.3 Event Attendee & Team Roster
- **Method / Path**: `GET /api/staff/events/:id/registrations`
- **Auth**: Assigned Staff (`VOLUNTEER` min) or Super Admin
- **Query Params**: `search` (name, email, or team)
- **Logic**: Returns all registrations with attendee profile, contact info, team info, check-in status, and parsed dynamic `form_responses`.
- **Response**: `200 OK` `EventRegistrationDetail[]`

### 11.4 Event Payment Queue & Review
- **Method / Path**: `GET /api/staff/events/:id/payments` and `POST /api/staff/events/:id/payments/:paymentId/review`
- **Auth**: Assigned `LEAD` or Super Admin
- **Logic**: 
  - `GET`: Returns payment verification requests for purchases that include this event.
  - `POST`: Allows Lead to `APPROVE`, `REJECT`, or `HOLD` payment for orders containing their event. Enforces no self-review invariant.
- **Response**: `200 OK`

### 11.5 Lead Event Configuration Update
- **Method / Path**: `PATCH /api/staff/events/:id`
- **Auth**: Assigned `LEAD` or Super Admin (Volunteers rejected with `403 FORBIDDEN`)
- **Schema**: `{ description?, venue?, metadata?, form_schema?, registration_closes_at? }`
- **Logic**: Allows Lead to update operational event information, rules, dynamic form schema, and deadlines.
- **Response**: `200 OK` `PublicEventResponse`

---

## 12. Admin Portal (`src/routes/admin-*.ts`)

### 12.1 Payment Review Queue (`admin-payments.ts`)
- **`GET /api/admin/payments`**: Lists submissions with filters (`status`, `search`, `cursor`, `limit`).
- **`POST /api/admin/payments/:id/review`**:
  - Auth: `canReviewPayments(user)` or `SUPER_ADMIN`.
  - Schema: `{ action: 'APPROVE' | 'REJECT' | 'HOLD', rejection_reason?: string, internal_note?: string }`
  - Anti-Self-Dealing: Reviewer cannot approve their own payment.
  - On `APPROVE`:
    - Updates payment `SUCCESS`, purchase `PAID`.
    - Locks student fields on buyer and all beneficiaries (`student_fields_locked = 1`).
    - Creates active `tickets` for all purchase items.
    - Confirms registrations and teams.
    - Fulfills tickets with `tx1...` HMACs.
    - If fulfillment throws, purchase stays `PAID` with `fulfillment_status = 'FAILED'`.

### 12.2 Purchase Supervision (`admin-purchases.ts`)
- **`GET /api/admin/purchases`**: Filter purchases across the festival.
- **`POST /api/admin/purchases/:id/retry-fulfillment`**: Retries ticket fulfillment on `PAID` purchases marked `FAILED`.

### 12.3 User Management (`admin-users.ts`)
- **`GET /api/admin/users`**: Search users by name, email, or role.
- **`PATCH /api/admin/users/:id`**: Super Admin only. Updates `role`, `can_review_payments`, and `is_active`. Cannot demote or deactivate self.

### 12.4 Event & Staff Control (`admin-events.ts`)
- **`POST /api/admin/events`**: Super Admin creates events (with optional `form_schema`).
- **`PATCH /api/admin/events/:id`**: Super Admin full update (fees, dates, capacity, status, rules, `form_schema`).
- **`DELETE /api/admin/events/:id`**: Safe deletion (hard delete if 0 registrations/tickets; transitions to `CANCELLED` if attendees exist).
- **`POST /api/admin/events/:id/staff`**: Assigns Lead or Volunteer to an event.
- **`DELETE /api/admin/events/:id/staff/:userId`**: Removes staff assignment.
- **`GET /api/admin/events/:id/staff`**: Lists assigned staff for an event.

### 12.5 Ticket Life Cycle Overrides (`admin-tickets.ts`)
- **`POST /api/admin/tickets/:id/revoke`**: Revokes ticket, removes from check-in.
- **`POST /api/admin/tickets/:id/reissue`**: Marks old ticket `REPLACED` and issues fresh ticket with version 1.
- **`POST /api/admin/tickets/:id/rotate-qr`**: Increments `qr_version` to invalidate screenshots.
- **`POST /api/admin/tickets/:id/undo-checkin`**: Deletes admission log and clears check-in timestamp.

### 12.6 Reports & BI (`admin-reports.ts`)
- **`GET /api/admin/reports/summary`**: Total revenue, ticket sales count, verified attendees.
- **`GET /api/admin/reports/financial`**: Detailed breakdown by payment method, General vs Student tier, item types.
- **`GET /api/admin/reports/attendance`**: Gate turnstile counts per day and event admissions.

### 12.7 Audit Logs (`admin-audit.ts`)
- **`GET /api/admin/audit-logs`**: Paginated query of immutable audit trails.

### 12.8 Global Settings & Fest Days (`admin-settings.ts`)
- **`PATCH /api/admin/settings`**: Super Admin updates prices, `purchases_enabled`, or support contact.
- **`PATCH /api/admin/fest-days/:dayNumber`**: Updates fest day schedule. Automatically adjusts active ticket validity windows.

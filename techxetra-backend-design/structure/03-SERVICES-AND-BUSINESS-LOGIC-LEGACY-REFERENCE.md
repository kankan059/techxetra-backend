> REFERENCE STATUS: This document describes the previous implementation and is retained only as a domain/capability checklist. It is NOT the target runtime, schema, route contract, or authority when it conflicts with `docs/` or `GREENFIELD-BACKEND-SPEC.md`. Do not implement Hono, Workers, D1, SQLite, Wrangler, or old implementation-specific details from this file. Latest decisions in `docs/DECISIONS-AND-OPEN-CHOICES.md` supersede conflicting staff-payment, auth, privacy, concurrency, and schema behavior.

# 03 — Services and Business Logic

This document details the core business workflows, transaction builders, algorithms, and domain rules implemented across the 21 service modules in `src/services/`.

---

## 🏗️ Service Architecture Overview

```
                                  HTTP Routes
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
       Identity & Session                           Ticketing & Commerce
     - session.service.ts                         - purchase.service.ts
     - google-auth.service.ts                     - payment.service.ts
     - password.service.ts                        - ticket.service.ts
     - user.service.ts                            - scan.service.ts
     - profile.service.ts                         - team.service.ts
     - authz.service.ts                           - event.service.ts
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       ▼
                              Admin & Operations
                            - admin-user.service.ts
                            - admin-ticket.service.ts
                            - admin-registration.service.ts
                            - staff-event.service.ts
                            - esports.service.ts
                            - report.service.ts
                            - settings.service.ts
                            - audit.service.ts
                            - idempotency.service.ts
```

---

## 1. Authentication, Sessions & Profile

### 1.1 Session Storage & Hashing (`session.service.ts`)
- Raw session token: 32 bytes (64 hex characters) generated via `crypto.getRandomValues()`.
- Hashed token: SHA-256 hex digest of the raw token.
- Lookup: The client cookie transmits the raw token. The backend hashes it and queries `SELECT * FROM sessions WHERE id = ?`.
- **Sliding Session Rule**:
  - For `PARTICIPANT`: If `remaining_ms < ttl_ms / 2` (i.e. < 15 days remaining on a 30-day session), the backend extends `expires_at` by a full TTL.
  - For staff (`VOLUNTEER`, `LEAD`, `SUPER_ADMIN`): Session has a hard 12-hour limit without sliding extension.

### 1.2 Account Linking, Registration & User IDs (`user.service.ts`, `password.service.ts`)
- **User ID Format (`TX26XXXX`)**:
  - All new user accounts (both Google OAuth and Password registrations) are assigned sequential IDs in the format `TX26XXXX` (e.g. `TX260001`, `TX260002` up to `TX269999`).
  - Generated via `generateNextUserId(db)` which inspects the highest existing `TX26%` ID and increments the numeric counter.
- **Google OAuth Linking**:
  1. If `google_sub` exists in `users`, verify account is active and return user.
  2. If `email` exists in `users` (e.g. invited team member or pre-registered staff):
     - If `user.google_sub` is not null and does not match the token's sub, throw `409 ACCOUNT_CONFLICT`.
     - Otherwise, link `google_sub = sub` atomically.
  3. If user does not exist, insert a new `PARTICIPANT` user with sequential ID `TX26XXXX`.
  4. Automatically link any pending team invitations:
     `UPDATE team_members SET user_id = ? WHERE invited_email = ? AND user_id IS NULL`.
- **Native Password Auth**:
  - Uses PBKDF2-SHA256 with 100,000 iterations and a 16-byte cryptographically secure salt.
  - Stored format: `pbkdf2:sha256:100000:<salt_hex>:<hash_hex>`.
  - Constant-time string verification prevents timing side-channel attacks.

### 1.3 Profile Completeness & Student Locking (`profile.service.ts`)
A profile is complete (`profile_complete: true`) if and only if:
1. `name`: trimmed string length $\ge 2$ characters.
2. `phone`: 10-digit Indian phone number matching `/^[6-9]\d{9}$/`.
3. If `is_student === 1`:
   - `institution_name`: trimmed string between 2 and 100 characters.
   - `institution_id`: non-empty string between 1 and 40 characters (Roll / Registration No).
   - If `is_student === 0`, institution fields are automatically cleared to `null`.
- **Student Fields Locking Invariant**: Once a user has an approved student purchase (`student_fields_locked === 1`), they **cannot** edit `is_student`, `institution_name`, or `institution_id`. Any attempt throws `403 STUDENT_FIELDS_LOCKED`. Only a Super Admin can modify locked fields.

---

## 2. Teams and Roster Management (`team.service.ts`)

### 2.1 Team State Machine
```
   [Leader creates team]
            │
            ▼
        ┌───────┐
        │ DRAFT │ ◄── [Add/Remove members, Accept/Decline invites]
        └───┬───┘
            │ [Leader initiates pass checkout]
            ▼
        ┌────────┐
        │ LOCKED │ ─── [Reservation expires/cancelled] ──► DRAFT
        └───┬────┘
            │ [Payment approved by Admin]
            ▼
       ┌───────────┐
       │ CONFIRMED │
       └───────────┘
```

### 2.2 Roster & Checkout Validation Rules
Before a team can proceed to checkout (`validateTeamForPurchase`):
1. Team must be in `DRAFT` status.
2. Caller must be the team leader.
3. Roster count of accepted members must satisfy: `min_team_size <= count <= max_team_size`.
4. All accepted members must have completed profiles (`profile_completed_at IS NOT NULL`).
5. No member can be currently registered or have an active reservation for this event (`ux_registrations_event_participant`).

---

## 3. Purchases, Checkout & Inventory Holding (`purchase.service.ts`)

### 3.1 15-Minute Reservation Lifecycle
```
                                 POST /api/purchases
                                          │
                                          ▼
                               ┌──────────────────────┐
                               │   AWAITING_PAYMENT   │
                               │  (15-min countdown)  │
                               └──────────┬───────────┘
                       ┌──────────────────┴──────────────────┐
                       │                                     │
           [Timer expires or user cancels]           [Submits UPI UTR]
                       │                                     │
                       ▼                                     ▼
                ┌──────────────┐                  ┌─────────────────────┐
                │ EXPIRED /    │                  │ PENDING_VERIFICATION│
                │ CANCELLED    │                  │  (Timer suspended)  │
                │(Slots freed) │                  └──────────┬──────────┘
                └──────────────┘                             │
                                                ┌────────────┴────────────┐
                                                │                         │
                                            [Rejected]                [Approved]
                                                │                         │
                                                ▼                         ▼
                                         ┌──────────────┐          ┌──────────────┐
                                         │    FAILED    │          │     PAID     │
                                         └──────────────┘          │(Tickets sent)│
                                                                   └──────────────┘
```

### 3.2 Pricing Calculation Matrix
- **Gate Pass**: General (`gate_pass_price_paise`) vs Student (`gate_pass_student_price_paise`).
- **Solo Event Pass**: General (`price_paise`) vs Student (`student_price_paise`).
- **Team Event — `PER_PARTICIPANT`**:
  - Computed per member: student price for student members, general price for non-student members.
- **Team Event — `PER_TEAM`**:
  - **All-Student Rule**: Student pricing is applied **only** if every accepted team member qualifies as a student. If even one member is not a student, the general team price applies.
  - The entire team fee is charged to the team leader; member purchase items have `unit_price_paise = 0`.

### 3.3 Atomic Inventory Holding Batch
To hold inventory without interactive transactions, the backend executes an atomic D1 batch:
```sql
-- 1. Insert purchase header
INSERT INTO purchases (id, buyer_id, total_amount_paise, status, reservation_expires_at, ...) VALUES (...);

-- 2. Insert items and reservations
INSERT INTO purchase_items (...) VALUES (...);
INSERT INTO registrations (id, event_id, team_id, participant_id, status, seat_count, ...) VALUES (...);

-- 3. Decrement available capacity conditionally
UPDATE events SET seats_taken = seats_taken + ? WHERE id = ? AND seats_taken + ? <= capacity;

-- 4. Guard verification: Abort batch if event was already full
INSERT INTO _guard (id) SELECT 1 WHERE NOT EXISTS (
  SELECT 1 FROM events WHERE id = ? AND seats_taken <= capacity
);

-- 5. Lock team if applicable
UPDATE teams SET status = 'LOCKED' WHERE id = ? AND status = 'DRAFT';
INSERT INTO _guard (id) SELECT 1 WHERE NOT EXISTS (
  SELECT 1 FROM teams WHERE id = ? AND status = 'LOCKED'
);
```

### 3.4 Zero-Paise Free Orders
If `total_amount_paise === 0`:
- Purchase status is set directly to `PAID` (`payment_method: 'FREE'`).
- Registrations are set directly to `CONFIRMED`.
- Teams are set directly to `CONFIRMED`.
- Tickets are fulfilled immediately in the same batch.

---

## 4. Manual UPI Payment Review (`payment.service.ts`)

### 4.1 Verification Lifecycle & Invariants
1. **UTR Submission**:
   - Buyer submits 12-digit alphanumeric UTR / Transaction ID.
   - Normalization converts to uppercase and strips whitespace.
   - Partial unique index `ux_payments_active_utr` blocks duplicate active submissions of the same UTR.
2. **Anti-Self-Dealing Invariant**:
   - Reviewers and Super Admins **cannot** approve or review their own payment submissions (`reviewer.id !== purchase.buyer_id`).
3. **Approval Execution Flow**:
   - Payment marked `SUCCESS`.
   - Purchase marked `PAID`.
   - Buyer and all beneficiary profiles have `student_fields_locked = 1`.
   - Registrations transitioned from `RESERVED` to `CONFIRMED`.
   - Team status set to `CONFIRMED`.
   - Digital tickets created for each purchase item with validity matching fest days.
4. **Durable Payment Truth Invariant**:
   - If ticket fulfillment throws an unexpected error after payment approval, the payment **remains approved** (`status: 'PAID'`). The backend sets `fulfillment_status = 'FAILED'` and records `fulfillment_last_error`.
   - Reviewers can subsequently call `POST /api/admin/purchases/:id/retry-fulfillment` to re-attempt ticket generation without double-charging or reverting payment truth.

---

## 5. QR Code Generation & Staff Scanner (`qr.ts`, `scan.service.ts`)

### 5.1 QR Token Format & Cryptography
```
tx1.<ticket_id>.<qr_version>.<hmac_signature>
```
- **Algorithm**: Web Crypto HMAC-SHA256.
- **Payload**: `tx1|<ticket_id>|<qr_version>`
- **Secret Key**: `TICKET_HMAC_SECRET` from environment bindings.
- **Signature Length**: 22 characters (Base64URL without padding).
- **Constant-Time Verification**: Uses `constantTimeEqual` to prevent timing attacks.

### 5.2 Admission Check-In Logic
- **Pre-Admit Inspection (`/lookup`)**:
  - Safe, read-only endpoint called by scanner cameras on token detection.
  - Checks expiration timestamps against current time.
  - Checks if physical student ID verification is required (`requires_id_check: true` when `tier === 'STUDENT'`).
  - Detects duplicate gate entries within 15 minutes to warn against badge pass-backs.
- **Admit Execution (`/admit`)**:
  - Validates staff permissions: Gate staff for gate tickets, assigned event staff for event tickets.
  - Enforces `student_id_checked === true` if ticket is a student ticket.
  - **Single-Use Check-In for Events**: Enforced at the database level by partial unique index `ux_checkin_event_once`. Duplicate admissions fail with `409 ALREADY_CHECKED_IN`.
  - Atomically marks `tickets.event_checked_in_at = now` and logs admission to `check_in_logs`.

---

## 6. E-Sports Tournament Scoring (`esports.service.ts`)

### 6.1 Concurrency & Integrity Controls
- **Event Category Invariant**: Scoring is restricted strictly to events with `category = 'E_SPORTS'` (enforced by SQL check constraint `ck_events_esports_scoring`).
- **Optimistic Concurrency**:
  - When saving round scores, the client passes `expected_version`.
  - If another staff member updated the score concurrently, the version comparison fails, preventing score overwrite conflicts (`409 SCORE_VERSION_CONFLICT`).
- **Append-Only Score History**:
  - Every score creation, update, or deletion inserts a record into `esports_score_history`.
  - SQLite triggers `tr_esports_score_history_no_update` and `tr_esports_score_history_no_delete` abort any update or deletion on this history table.
- **Tie-Breaking Algorithm**:
  - Total score is computed across all rounds.
  - Ties are broken by evaluating the highest single-round score, followed by the second highest, etc.

---

## 7. Audit Logging & Reporting (`audit.service.ts`, `report.service.ts`)

### 7.1 Immutable Audit Trails
- Administrative actions (`EVENT_CREATED`, `EVENT_UPDATED`, `SETTINGS_UPDATED`, `TICKET_REVOKED`, `USER_ROLE_UPDATED`, etc.) write to `audit_logs`.
- Payment status transitions write to `payment_audit_logs`.
- SQLite triggers prevent modifications or deletions to audit tables.

### 7.2 Financial & Operational Reporting
- **Paise Precision**: Aggregates revenues in integer paise to eliminate rounding errors.
- **Summary Metrics**: Total gross revenue, approved payments count, active participant count, ticket distribution (Gate vs Event), and capacity utilization percentage.

---

## 8. Event Committee Operations & Dynamic Forms (`staff-event.service.ts`)

### 8.1 Scoped Access Control Matrix
| Resource / Operation | Super Admin | Event Lead | Event Volunteer | General Participant |
|---|---|---|---|---|
| View All Events in Hub | All | Assigned Only | Assigned Only | None (Forbidden) |
| View Event Dashboard & Metrics | Any Event | Assigned Event | Assigned Event | None |
| View Attendee & Team Roster | Any Event | Assigned Event | Assigned Event | None |
| View Payment Queue & UTRs | Any Event | Assigned Event | Forbidden | None |
| Approve / Reject Event Payments | Yes | Yes (No Self-Review) | Forbidden | None |
| Update Event Venue / Description / Rules | Yes | Yes | Forbidden | None |
| Update Fees / Capacity / Schedule | Yes | Forbidden | Forbidden | None |
| Scan QR Pass at Venue (`context: EVENT`) | Any Event | Assigned Event | Assigned Event | None |

### 8.2 Dynamic Registration Form Schema & Responses
- **Schema (`events.form_schema`)**: Stored as a JSON array of question definitions (`id`, `label`, `type`, `required`, `placeholder`, `options`).
- **Validation during Checkout**:
  - In `purchase.service.ts`, when a user reserves an `EVENT_PASS`, if the event has `form_schema`, each question marked `required: true` must have a non-empty answer in `form_responses`.
  - Missing answers reject checkout with `400 VALIDATION_ERROR`.
- **Persistence (`registrations.form_responses`)**: User responses are stored as JSON with the registration record, returned in attendee rosters, and made accessible to event committee leads for operational planning.

### 8.3 Event Updates & Lead Scope (`event.service.ts`)
- **Lead Scope**: Event Leads can update `description`, `venue`, `metadata`, `form_schema`, and `registration_closes_at`. Any attempt to modify fees, capacity, team sizing, or category throws `403 FORBIDDEN`.
- **Super Admin Scope**: Full edit permissions across all event parameters.
- **Capacity Integrity**: Reductions in `capacity` below current `seats_taken` are rejected with `400 VALIDATION_ERROR`.

### 8.4 Safe Event Deletion & Graceful Cancellation (`event.service.ts`)
- **`deleteEventByAdmin(db, eventId, actor)`**:
  - Checks for active registrations (`RESERVED`, `CONFIRMED`) or issued tickets for the event.
  - **With Attendees**: Cannot hard-delete without breaking relational integrity and participant records. Automatically transitions `events.status = 'CANCELLED'`, retains all attendee records, and logs `EVENT_CANCELLED` to `audit_logs`.
  - **Zero Attendees**: Atomically hard-deletes `event_staff` assignments and the `events` row in a batch, logging `EVENT_DELETED` to `audit_logs`.

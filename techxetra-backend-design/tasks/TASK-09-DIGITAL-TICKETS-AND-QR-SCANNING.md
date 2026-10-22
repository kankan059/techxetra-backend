# TASK 09: Digital Tickets, Tamper-Proof HMAC QR Codes & Scanner Check-In

## Objective

Implement cryptographic HMAC-SHA256 signed QR codes, participant ticket
views, the volunteer scanning inspection endpoint, single-use event
admissions, and anti-passback warnings.

------------------------------------------------------------------------

## 1. QR Cryptography Format (`src/utils/qr.ts`)

Tickets generate scannable QR tokens formatted as:

    tx1.<ticket_id>.<qr_version>.<hmac_signature>

-   **Algorithm:** HMAC-SHA256 using `env.TICKET_HMAC_SECRET`.
-   **Payload String:** `tx1|<ticket_id>|<qr_version>`
-   **Signature:** 22-character Base64URL string (unpadded).
-   **Constant-Time Verification:** Use `crypto.timingSafeEqual` to
    verify the incoming signature against the recomputed signature to
    prevent timing side-channel attacks.

------------------------------------------------------------------------

## 2. Participant Ticket Endpoints (`src/routes/tickets.ts`)

-   **`GET /api/tickets/mine`**:
    -   Auth: `requireAuth()`
    -   Returns all tickets where the caller is the `beneficiary_id`.
    -   Computes and includes the active `qr_token` for each ticket
        along with event details and fest day validity.
-   **`GET /api/tickets/:id`**:
    -   Returns detailed ticket info with signed `qr_token`.
    -   Enforces ownership (caller must be beneficiary or
        `SUPER_ADMIN`).

------------------------------------------------------------------------

## 3. Volunteer Scanner: Pre-Scan Lookup (`POST /api/staff/scan/lookup`)

Called when a volunteer points the scanner camera at an attendee's QR
badge: \* **Auth:** Staff Session (`VOLUNTEER`, `LEAD`, `SUPER_ADMIN`).
\* **Schema:**
`{ qr_token: string, context: 'GATE' | 'EVENT', event_id?: string }` \*
**Execution Flow:** 1. Decodes and verifies the HMAC-SHA256 signature in
constant time. Reject tampered codes with `400 INVALID_QR_TOKEN`. 2.
Verifies ticket exists, `status === 'ACTIVE'`, and QR version matches.
3. Checks time validity: current time must be between `valid_from` and
`valid_to`. 4. Checks venue staff permissions: \* If
`context === 'GATE'`: staff must be in `gate_staff` or Super Admin. \*
If `context === 'EVENT'`: staff must be assigned to that event or Super
Admin. 5. **Anti-Passback Warning (Gate Entry):** If scanned at the gate
within the last 15 minutes, flag
`warning: "Pass was scanned recently. Check for badge pass-back."` 6.
**Physical Student ID Requirement:** If `ticket.tier === 'STUDENT'`, set
`requires_id_check: true`. \* **Response:**
`json   {     "can_admit": true,     "attendee": { "name": "Priyank Sharma", "email": "...", "institution_name": "Tezpur University" },     "ticket_tier": "STUDENT",     "requires_id_check": true,     "warnings": []   }`

------------------------------------------------------------------------

## 4. Volunteer Scanner: Execute Admission (`POST /api/staff/scan/admit`)

Executes the physical admission: \* **Auth:** Staff Session. \*
**Schema:**
`ts   {     qr_token: string,     context: 'GATE' | 'EVENT',     event_id?: string,     student_id_checked: boolean,     client_scan_id?: string   }`
\* **Execution Flow:** 1. Verifies token and staff permissions. 2.
**Student ID Check Enforcement:** If `ticket.tier === 'STUDENT'` and
`student_id_checked !== true`, reject admission with
`400 VALIDATION_ERROR` (volunteer must physically inspect student ID
card). 3. Execute in a transaction: \* **Single-Use Check-In for
Events:** If `context === 'EVENT'`, check `tickets.event_checked_in_at`.
If already checked in, reject with `409 ALREADY_CHECKED_IN` (enforced by
DB partial unique index `(ticket_id, event_id)`). \* Mark
`tickets.event_checked_in_at = now`. \* Insert admission record into
`check_in_logs` (`verdict: 'ADMITTED'`). \* **Response:**
`{ admitted: true, check_in_id: "..." }`

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Forged or modified QR tokens fail signature verification.
-   [ ] Student passes require `student_id_checked: true` before
    admission is granted.
-   [ ] Scanning an event ticket a second time fails with
    `409 ALREADY_CHECKED_IN`.
-   [ ] Scanning a gate pass twice within 15 minutes returns a pass-back
    warning.

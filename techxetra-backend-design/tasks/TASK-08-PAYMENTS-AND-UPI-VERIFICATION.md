# TASK 08: Manual UPI Payments, Verification Queue & Durable Payment Truth

## Objective

Implement manual UPI payment submission (1-click deep links, UTR
recording, deduplication), payment withdrawal, the reviewer verification
workflow, strict anti-self-dealing rules, and the **Durable Payment
Truth invariant**.

------------------------------------------------------------------------

## 1. UPI Payment Intent & Submission Flow (`src/routes/payments.ts`)

### 1.1 Get UPI Details & 1-Click Intent

-   **Endpoint:** `GET /api/purchases/:id/payment`
-   **Auth:** `requireAuth()` (enforces purchase ownership)
-   **Response:**
    -   `upi_vpa`: `env.UPI_VPA`
    -   `payee_name`: `env.UPI_PAYEE_NAME`
    -   `amount_paise`: Total purchase amount
    -   `upi_intent_uri`: Standard URI format for mobile payment apps:
        `upi://pay?pa=<vpa>&pn=<name>&am=<amount_in_rupees>&cu=INR&tn=TechXetra-Order-<purchase_id>`

### 1.2 Submit Bank UTR Number

-   **Endpoint:** `POST /api/purchases/:id/payment`
-   **Auth:** `requireAuth()`
-   **Schema:**
    `{ transaction_id: string (8-35 alphanumeric), idempotency_key?: string }`
-   **Execution Flow:**
    1.  Purchase must be `AWAITING_PAYMENT` and reservation not expired.
    2.  Normalize UTR: trim, strip spaces/hyphens, convert to uppercase.
    3.  **Duplicate UTR Protection:** Check that this UTR is not already
        in `PENDING` or `SUCCESS` status in the `payments` table.
    4.  In a native transaction:
        -   Transition `purchases.status` to `PENDING_VERIFICATION`
            (freezes the 15-minute countdown).
        -   Insert row into `payments` (`status: 'PENDING'`).
        -   Record entry in `payment_audit_logs`.
-   **Response:** `201 Created` with submitted payment status.

### 1.3 Withdraw Payment Submission

-   **Endpoint:** `POST /api/purchases/:id/payment/withdraw`
-   **Auth:** `requireAuth()`
-   **Logic:** If purchase is `PENDING_VERIFICATION`, marks payment as
    `WITHDRAWN`, and resets purchase back to `AWAITING_PAYMENT` with a
    **fresh 15-minute reservation timer**.

------------------------------------------------------------------------

## 2. Reviewer Verification Queue (`src/services/payment.service.ts`)

ONLY `SUPER_ADMIN` can review, approve, reject, or hold manual UPI
payment submissions. Event Leads and Volunteers have no payment-review
access, even if legacy `can_review_payments` data is set. Do not grant
payment review based on event assignment.

### 2.1 The Anti-Self-Dealing Invariant

-   **Rule:** A reviewer can **never** review, approve, reject, or place
    a hold on their own purchase (`reviewer.id !== purchase.buyer_id`).
    Enforce this in the service transaction, not only in route
    middleware.
-   Attempting self-review must throw `403 FORBIDDEN` with code
    `CANNOT_REVIEW_OWN_PAYMENT`.

### 2.2 Payment Review Actions

-   **Endpoint:** `POST /api/admin/payments/:id/review` only. Do not
    create a staff/event-lead payment-review endpoint.
-   **Schema:**
    `{ action: 'APPROVE' | 'REJECT' | 'HOLD', rejection_reason?: string, internal_note?: string }`

#### On `REJECT`:

-   Set payment `status = 'REJECTED'`.
-   Apply the current payment rejection state machine consistently:
    record the payment as `REJECTED`, preserve payment/audit history,
    return the purchase to the documented retryable state with a fresh
    reservation only if the business rules permit retry, and release
    seats/registrations/teams only when that transition is safe. Do not
    set purchase to a terminal failure and then also imply it can be
    retried; implement one internally consistent state transition and
    test it.

#### On `HOLD`:

-   Keep purchase in `PENDING_VERIFICATION` and update internal reviewer
    notes.

#### On `APPROVE`:

In one native PostgreSQL transaction, lock and re-check the payment and
purchase; set payment `status = 'SUCCESS'`, `reviewed_by = reviewer.id`,
`reviewed_at = now`; set purchase `status = 'PAID'`; lock student fields
for the buyer and beneficiaries as applicable; confirm registrations and
teams; and append the immutable audit record. Commit this transaction
before ticket fulfillment.

After commit, invoke the idempotent ticket-fulfillment service in a
separate recoverable transaction/job. If fulfillment fails, leave the
purchase `PAID`, set `fulfillment_status = 'FAILED'`, record the error,
and permit an authorized Super Admin retry. Do not roll back payment
approval or downgrade purchase status because ticket issuance failed.

------------------------------------------------------------------------

## 3. The "Durable Payment Truth" Invariant

Payment approval represents financial reality. If ticket generation or
database insertion encounters an unexpected issue **after** a payment
has been verified: \* **NEVER downgrade the purchase back to
`AWAITING_PAYMENT` or `UNPAID`.** \* The purchase must remain
`status = 'PAID'`. \* Set `purchases.fulfillment_status = 'FAILED'` and
record `fulfillment_last_error`. \* Expose an admin endpoint:
`POST /api/admin/purchases/:id/retry-fulfillment` to re-attempt ticket
generation safely without double-charging or corrupting payment truth.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Submitting a UTR transitions the purchase to
    `PENDING_VERIFICATION` and pauses the expiry timer.
-   [ ] Submitting a duplicate UTR already in use fails with
    `409 DUPLICATE_TRANSACTION_ID`.
-   [ ] Only Super Admin can review payments; Lead/Volunteer attempts
    return `403 FORBIDDEN`.
-   [ ] Super Admin cannot approve their own purchase
    (`CANNOT_REVIEW_OWN_PAYMENT`).
-   [ ] Approving a student purchase sets `student_fields_locked = 1`
    across all attendees.
-   [ ] If ticket fulfillment throws an error, the purchase remains
    permanently `PAID`.

## 4. Mandatory payment ownership and authorization decision

**Decision: payment verification is centralized and performed only by
`SUPER_ADMIN`.**

-   `GET /api/admin/payments` and `POST /api/admin/payments/:id/review`
    are the only review queue/action routes.
-   Event Leads and Volunteers must receive `403 FORBIDDEN` from all
    payment review endpoints, even for events assigned to them.
-   Event staff may see an event's registration/payment state needed for
    operations (for example, `PAID` / `PENDING_VERIFICATION` /
    `AWAITING_PAYMENT`) but must not see UTRs, payment evidence,
    internal reviewer notes, full financial review records, or
    approve/reject/hold payments.
-   The admin queue shows the full purchase and all items/events covered
    by it, total amount in integer paise, normalized transaction ID,
    payment attempt history, and buyer identity required for
    verification. Restrict the queue to authorized super admins.
-   The review action applies to the **entire purchase-level payment**.
    If one purchase contains multiple event items, approving it confirms
    the purchase and all eligible registrations in that purchase. The
    admin must be shown the complete order before acting.
-   Keep one payment per order as the selected model for this migration.
    Do not split the payment per event in this migration unless the
    owner explicitly changes the decision; splitting requires a separate
    design for partial payment, partial fulfillment, and order state.
-   A participant's submitted UTR is never proof of payment by itself.
    Tickets are created only after the authorized admin approves the
    payment (except legitimate zero-value orders).
-   Legacy `can_review_payments` must not grant payment review to
    Leads/Volunteers. Remove it from the target model if safe, or
    preserve it only as inert compatibility data.
-   Every review action must be transactional, re-check current status
    under lock, prevent duplicate concurrent decisions, record
    actor/time/reason, and append an immutable payment audit entry.

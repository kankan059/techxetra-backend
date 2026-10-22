# TASK 07: Checkout, 15-Minute Seat Hold & Native PostgreSQL Transactions

## Objective

Implement ticket checkout reservations, dynamic pricing matrices
(Student vs. General, All-Student team rule), custom registration
question validation, and capacity protection using **native PostgreSQL
interactive transactions with row-level locking
(`SELECT ... FOR UPDATE`)**.

------------------------------------------------------------------------

## 1. 15-Minute Reservation Lifecycle (`src/services/purchase.service.ts`)

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
              │(Seats freed) │                  └──────────┬──────────┘
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

------------------------------------------------------------------------

## 2. Native PostgreSQL Capacity Locking (`SELECT ... FOR UPDATE`)

Unlike SQLite, PostgreSQL supports true row-level locks. During
checkout, lock the event row to prevent overselling under high
concurrency:

``` ts
await db.transaction(async (tx) => {
  // 1. Lock the event row for update
  const [event] = await tx
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .for('update')

  if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found')

  // 2. Check capacity atomically
  if (event.seats_taken + requiredSeats > event.capacity) {
    throw new AppError(409, 'CAPACITY_FULL', 'This event has reached full capacity')
  }

  // 3. Increment seats taken
  await tx
    .update(events)
    .set({
      seats_taken: event.seats_taken + requiredSeats,
      updated_at: now,
    })
    .where(eq(events.id, eventId))

  // 4. Insert purchase, purchase_items, and reservations
  // ...
})
```

------------------------------------------------------------------------

## 3. Pricing Matrix Rules

All monetary values are calculated and stored in **paise**
(`₹100 = 10000`):

1.  **Festival Gate Pass:** General price (`gate_pass_price_paise`)
    vs. Student price (`gate_pass_student_price_paise`).
2.  **Solo Event Pass:** General price (`price_paise`) vs. Student price
    (`student_price_paise`).
3.  **Team Event (`PER_PARTICIPANT`):** Each accepted member is priced
    individually according to their student status.
4.  **Team Event (`PER_TEAM`) --- The All-Student Rule:**
    -   Student team rate is applied **only if 100% of accepted members
        are verified students**.
    -   If even one member is a non-student, the full general team rate
        applies.
    -   The entire team fee is charged to the team leader; individual
        member items have `unit_price_paise = 0`.
5.  **Student ID Policy Acknowledgment:** If any item benefits from
    student pricing, the buyer must provide
    `acknowledge_student_id_policy: true`.

------------------------------------------------------------------------

## 4. Dynamic Custom Form Validation

-   If an event has a configured `form_schema`, validate each submission
    against the full schema, not only required-field emptiness. Validate
    field IDs, supported types, value types, allowed options, min/max
    length or numeric bounds, and required fields. Reject unknown IDs
    and malformed schema/response JSON with `400 VALIDATION_ERROR`;
    never catch-and-ignore parse/validation errors.
-   The server is authoritative. Never trust the frontend to enforce the
    schema or price.
-   Define answer scope explicitly: event-level/team-level answers are
    stored once per team registration; participant-specific answers must
    be stored per participant/beneficiary. Do not pretend a single
    team-level JSON object contains answers for every team member.
-   Persist a schema version/snapshot with each registration (or freeze
    schema edits after registrations exist). Staff must be able to
    interpret old answers against the schema that was active when
    submitted.

------------------------------------------------------------------------

## 5. Instant Fulfillment for Free Passes (₹0 Orders)

If the calculated total is ₹0 (e.g. free events or free passes): 1.
Immediately set `purchases.status = 'PAID'` (`payment_method: 'FREE'`).
2. Set `registrations.status = 'CONFIRMED'`. 3. If team event, set
`teams.status = 'CONFIRMED'`. 4. Create and fulfill active digital
tickets immediately within the same transaction.

------------------------------------------------------------------------

## 6. Endpoints (`src/routes/purchases.ts`)

-   **`POST /api/purchases`**:
    -   Auth: `requireAuth()`, `requireProfileComplete()`.
    -   Creates reservation, locks seats, and starts 15-minute
        countdown.
    -   Maximum 3 open purchases allowed per buyer. Auto-cancels expired
        orders.
-   **`GET /api/purchases/mine`**: Returns user's order history.
-   **`GET /api/purchases/:id`**: Returns detailed purchase order with
    items, status, and expiry timer.
-   **`POST /api/purchases/:id/cancel`**:
    -   Can only cancel if status is `AWAITING_PAYMENT`.
    -   Decrements `events.seats_taken`, cancels registrations, and
        unlocks teams back to `DRAFT`.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Concurrent checkout requests for the last remaining seat: only 1
    succeeds, other fails with `409 CAPACITY_FULL`.
-   [ ] Team "All-Student Rule": A team with 3 students and 1
    non-student is correctly billed the general rate.
-   [ ] Missing required custom form answers throw
    `400 VALIDATION_ERROR`.
-   [ ] Free orders (₹0) skip manual payment and immediately issue
    confirmed tickets.
-   [ ] Cancelling a reservation restores event seats and returns the
    team to `DRAFT`.

## Mandatory custom registration form contract

Use a documented, strict schema shape with stable `id`, `label`, `type`,
`required`, and type-specific properties. Supported types must be
enumerated (for example: short text, long text, number, single select,
multi-select, checkbox, email, URL); do not accept arbitrary type
strings. Validate `options` and bounds for the relevant types.
Normalize/trim values where appropriate and enforce maximum payload
size.

Event Leads may edit the form only before any registrations exist,
unless the implementation adds schema versioning that preserves old
answers and safely handles new submissions. Volunteers cannot edit
forms. Super Admin can override only through an audited action. A
malformed schema must block event publication/registration and produce a
clear operational error rather than bypassing validation.

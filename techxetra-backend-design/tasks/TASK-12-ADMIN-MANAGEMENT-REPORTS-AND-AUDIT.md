# TASK 12: Super Admin Operations, BI Reports & Audit Logging

## Objective

Implement Super Admin control operations: user role management, central
payment desk, safe event deletion, ticket lifecycle overrides, fest
settings/dates, business intelligence reporting, and immutable audit
logs.

------------------------------------------------------------------------

## 1. User Directory & Role Promotion (`src/routes/admin-users.ts`)

-   **`GET /api/admin/users`**: Search users by name, email, or role
    (`PARTICIPANT`, `VOLUNTEER`, `LEAD`, `SUPER_ADMIN`).
-   **`PATCH /api/admin/users/:id`**:
    -   Auth: `requireSuperAdminOnly()`.
    -   Schema: `{ role?: UserRole, is_active?: boolean }` (do not
        expose a `can_review_payments` grant; Super Admin role is the
        sole payment-review authority)
    -   **Self-Demotion Invariant:** Super Admins cannot demote their
        own role or deactivate their own account.
    -   Writes administrative action to `audit_logs`.

------------------------------------------------------------------------

## 2. Event Supervision & Safe Deletion (`src/routes/admin-events.ts`)

-   **`POST /api/admin/events`**: Super Admin creates new events (with
    optional `form_schema`).
-   **`PATCH /api/admin/events/:id`**: Full configuration updates (fees,
    dates, capacity, status, rules).
    -   Capacity Integrity: Reductions in `capacity` below current
        `seats_taken` must be rejected with `400 BAD_REQUEST`.
-   **Safe Deletion Invariant (`DELETE /api/admin/events/:id`):**
    -   Check for existing registrations or tickets for this event.
    -   **With Attendees:** Cannot hard-delete without breaking attendee
        records. Automatically transition `events.status = 'CANCELLED'`,
        retain attendee data, and log `EVENT_CANCELLED` to `audit_logs`.
    -   **Zero Attendees:** Hard-delete `event_staff` assignments and
        the `events` row cleanly, logging `EVENT_DELETED`.

------------------------------------------------------------------------

## 3. Staff Assignment Control (`src/routes/admin-events.ts`)

-   **`POST /api/admin/events/:id/staff`**: Assigns a user as `LEAD` or
    `VOLUNTEER` for an event.
-   **`DELETE /api/admin/events/:id/staff/:userId`**: Removes staff
    assignment.
-   **`GET /api/admin/events/:id/staff`**: Lists all staff members
    assigned to the event.

------------------------------------------------------------------------

## 4. Ticket Lifecycle Overrides (`src/routes/admin-tickets.ts`)

-   **`POST /api/admin/tickets/:id/revoke`**: Revokes ticket, removes
    from check-in.
-   **`POST /api/admin/tickets/:id/reissue`**: Marks old ticket
    `REPLACED` and issues a fresh ticket with version 1.
-   **`POST /api/admin/tickets/:id/rotate-qr`**: Increments
    `qr_version = qr_version + 1`. This immediately invalidates
    previously saved screenshots without changing the ticket itself.
-   **`POST /api/admin/tickets/:id/undo-checkin`**: Deletes the
    admission log entry and clears `event_checked_in_at` if a volunteer
    scanned by mistake.

------------------------------------------------------------------------

## 5. Global Fest Settings & Schedule (`src/routes/admin-settings.ts`)

-   **`PATCH /api/admin/settings`**: Updates pass prices,
    `purchases_enabled` toggle, or support email.
-   **`PATCH /api/admin/fest-days/:dayNumber`**: Updates festival day
    dates.
    -   **Automatic Sync Invariant:** Updating a fest day's `valid_from`
        or `valid_to` automatically updates all active tickets linked to
        that day so their QR validity matches the new schedule.

------------------------------------------------------------------------

## 6. Business Intelligence & Reports (`src/routes/admin-reports.ts`)

All financial calculations use integer **paise**: 1. **Summary Report
(`GET /api/admin/reports/summary`):** \* Total gross revenue collected
(`SUM(amount_paise)` of `SUCCESS` payments). \* Total passes sold (Gate
vs. Event). \* Verified attendees count. \* Capacity utilization
percentage across all events. 2. **Financial Report
(`GET /api/admin/reports/financial`):** \* Revenue breakdown by payment
method (UPI vs Free). \* Revenue breakdown by tier (General vs Student).
3. **Attendance Turnstile Report
(`GET /api/admin/reports/attendance`):** \* Hourly and daily gate
check-in turnstile counts. \* Event check-in turnout counts vs confirmed
registrations.

------------------------------------------------------------------------

## 7. Immutable System Audit Trails (`src/routes/admin-audit.ts`)

-   Administrative actions (`EVENT_CREATED`, `EVENT_UPDATED`,
    `SETTINGS_UPDATED`, `TICKET_REVOKED`, `USER_ROLE_UPDATED`, etc.)
    write to the `audit_logs` table.
-   Endpoint `GET /api/admin/audit-logs` provides paginated filtering by
    `action`, `actor_id`, and `target_type`.
-   The `audit_logs` table is strictly append-only.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Super Admin cannot demote or deactivate their own account.
-   [ ] Deleting an event with active attendees safely marks it
    `CANCELLED` instead of breaking records.
-   [ ] `rotate-qr` increments the QR version and invalidates old QR
    codes immediately.
-   [ ] Updating a fest day schedule automatically synchronizes ticket
    validity windows.
-   [ ] Reports calculate gross revenue accurately in integer paise.

## Mandatory payment-review ownership

-   Super Admin is the only role allowed to list detailed payment
    submissions or review them.
-   The Super Admin payment desk is the sole interface for UTR
    verification and payment decisions. Route guards and service-level
    authorization must both enforce `role === 'SUPER_ADMIN'`.
-   Event Leads and Volunteers must not approve/reject/hold payments,
    even for assigned events. Event staff can see a sanitized payment
    state only as part of their event roster/dashboard.
-   The payment queue must show all event items belonging to a purchase
    before a decision. A decision applies to the whole purchase-level
    payment; do not imply it applies to only one event.
-   Do not rely on `can_review_payments` to grant authority. If the
    field remains for migration compatibility, it must not override the
    Super Admin-only rule.
-   A payment review must lock and re-read payment/purchase state,
    enforce no-self-review, commit the payment/purchase/registration
    transition and audit history atomically, and reject stale concurrent
    review attempts.
-   Add tests for: non-super-admin forbidden, assigned lead forbidden,
    volunteer forbidden, super admin permitted, self-review forbidden,
    concurrent double-review rejected, and mixed-event purchase
    displayed with all items.

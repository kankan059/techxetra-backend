# TASK 11: Event Committee Portal & Attendee Roster Management

## Objective

Implement the scoped staff portal for Event Leads and Volunteers,
displaying assigned events, live metrics, attendee rosters with parsed
custom form answers, and read-only payment state visibility. Payment
verification is Super Admin-only.

------------------------------------------------------------------------

## 1. Scoped Access Control Matrix

All staff access is event-scoped. A `LEAD` or `VOLUNTEER` must only
access events explicitly assigned to that user. Knowing an event UUID
must never bypass assignment checks.

  -------------------------------------------------------------------------------------------------------
  Capability                            Super Admin           Assigned Event Lead Assigned      General
                                                                                  Event         User
                                                                                  Volunteer     
  ------------------------------------- --------------------- ------------------- ------------- ---------
  List/manage all events                Yes                   No                  No            No

  View assigned event dashboard/metrics Any event             Yes                 Yes           No

  View event attendee/team roster       Any event             Yes, full           Yes, minimum  No
                                                              event-operational   operational   
                                                              participant details details       
                                                                                  needed for    
                                                                                  their duties  

  View custom registration answers      Any event             Yes, for assigned   Yes, for      No
                                                              event               assigned      
                                                                                  event when    
                                                                                  needed for    
                                                                                  event         
                                                                                  operations    

  View UTR/payment evidence/internal    Yes, admin review     No                  No            No
  review notes                          only                                                    

  Approve/reject/hold payments          Yes                   **No**              **No**        No

  Edit event                            Yes                   Yes, assigned event No            No
  title/description/venue/rules/prize                         only                              
  pool/public metadata                                                                          

  Edit registration form schema         Yes, audited          Before              No            No
                                        override/versioning   registrations                     
                                                              exist; after that,                
                                                              versioned change                  
                                                              only                              

  Change ticket prices, student prices, Yes                   No                  No            No
  capacity, capacity unit, category,                                                            
  purchase/payment/ticket state                                                                 

  Assign staff/change roles             Yes                   No                  No            No

  Use event check-in/scanning routes    As authorized         Only if explicitly  Only for      No
                                                              permitted by route  assigned      
                                                              contract            event and     
                                                                                  scanning      
                                                                                  permissions   
  -------------------------------------------------------------------------------------------------------

### Participant data minimization

-   Event Leads can see the participant details needed to run their
    assigned event, including name, contact details, institution details
    where relevant, team/registration status, ticket/check-in status,
    and submitted answers for that event. Do not expose passwords,
    session tokens, Google subject, internal security fields, payment
    UTR, reviewer notes, or unrelated event registrations.
-   Volunteers see operational details only: participant display name,
    team, registration/ticket/check-in state, and form answers needed
    for event operations. Do not return email, phone, institution ID,
    payment evidence, or internal reviewer notes by default. If a
    specific duty requires additional fields, expose only those fields
    and document the permission.
-   Super Admin can access full participant and payment records for
    legitimate administration. Sensitive access must be authorized and
    audited.
-   Roster search and pagination must be event-scoped; do not allow
    search parameters to retrieve participants from other events.

## 2. Endpoints Implementation (`src/routes/staff-events.ts`)

### 2.1 List My Assigned Events

-   **Endpoint:** `GET /api/staff/events/mine`
-   **Auth:** Staff Session (`VOLUNTEER`, `LEAD`, or `SUPER_ADMIN`).
-   **Logic:**
    -   Super Admin receives all events.
    -   Leads and Volunteers receive only events where their `user_id`
        exists in `event_staff`.
    -   Computes live counts: `confirmed_count`, `reserved_count`,
        `seats_remaining`, and `pending_payments_count`.

### 2.2 Event Live Dashboard

-   **Endpoint:** `GET /api/staff/events/:id/dashboard`
-   **Auth:** Assigned Staff or Super Admin.
-   **Logic:** Returns event metadata, capacity metrics, total
    checked-in count, and the assigned staff roster.

### 2.3 Attendee & Team Roster

-   **Endpoint:** `GET /api/staff/events/:id/registrations`
-   **Auth:** Assigned Staff or Super Admin.
-   **Query Params:** `search?: string` (searches attendee name, email,
    or team name).
-   **Logic:**
    -   Queries registrations, team membership, beneficiaries, tickets,
        and check-in records through their actual relationships.
    -   Returns role-specific DTOs: Leads get approved event-operational
        participant details; Volunteers get only minimum operational
        fields by default. Never return UTRs, reviewer notes,
        credentials, or unrelated event data.
    -   Includes parsed `form_responses` with the schema
        version/snapshot used when the participant submitted them.

### 2.4 Payment status visibility (read-only; no review actions)

-   Event Leads and Volunteers may see only the minimal payment state
    required to understand whether an event registration is confirmed or
    awaiting payment.
-   Do not implement `GET /api/staff/events/:id/payments` as a
    payment-verification queue.
-   Do not implement
    `POST /api/staff/events/:id/payments/:paymentId/review`.
-   Do not return transaction IDs/UTRs, payment evidence, reviewer
    identity/notes, or full payment records to event staff.
-   All review, approve, reject, and hold actions are handled only by
    the Super Admin payment desk in TASK-08/TASK-12.

### 2.5 Operational Event Updates (Lead Scope)

-   **Endpoint:** `PATCH /api/staff/events/:id`

-   **Auth:** Assigned Event Lead or Super Admin (Volunteers rejected
    with `403 FORBIDDEN`).

-   **Schema:**

    ``` ts
    {
      title?: string,
      description?: string,
      venue?: string,
      rules?: unknown,
      metadata?: Record<string, unknown>, // includes approved public fields such as organizer, eligibility, prizes/prize_pool, timeline
      form_schema?: Array<{ id: string, label: string, type: string, required: boolean, options?: string[], min_length?: number, max_length?: number, min?: number, max?: number }>,
      registration_closes_at?: number
    }
    ```

-   **Protection Invariant:** Leads may update approved
    descriptive/public metadata for assigned events, including title,
    description, venue, rules, prize pool/prizes, organizer,
    eligibility, timeline, and other documented metadata. They may not
    modify ticket fees, student prices, capacity, capacity unit, event
    category, team sizing, purchase/payment/ticket state, staff
    assignments, or roles. Reject protected fields if submitted; do not
    silently ignore them. Volunteers cannot edit event configuration.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Volunteers and Leads can only see their assigned events in
    `GET /api/staff/events/mine`.
-   [ ] Volunteers are blocked from reviewing payments or editing event
    descriptions.
-   [ ] Attendee roster returns submitted custom question answers
    (`form_responses`).
-   [ ] Leads attempting to change ticket fees receive `403 FORBIDDEN`.
-   [ ] Any Lead or Volunteer attempting to review a payment receives
    `403 FORBIDDEN`; only Super Admin reaches payment review. Super
    Admin self-review receives `403 CANNOT_REVIEW_OWN_PAYMENT`.

## Mandatory roster and staff-security fixes

-   The current roster implementation joins a team registration to the
    registration's `participant_id`, which may be only the team leader,
    while tickets are associated with individual beneficiaries. Fix the
    data model/query so every accepted team member is listed and linked
    to their own ticket/check-in state. Do not create duplicate
    registrations to fake a roster.
-   Return custom form answers with their schema snapshot/version and a
    safe parsed representation. If schema validation fails, surface an
    operational error; do not silently drop answers.
-   Event Leads can view the full event-operational participant detail
    set, but never secrets, credentials, UTRs, reviewer notes, or
    unrelated events.
-   Volunteers receive a narrower response DTO by default; use separate
    serializers/DTOs rather than fetching sensitive fields and relying
    on the frontend to hide them.
-   Every event-scoped route must verify assignment in the backend for
    every request, including dashboard, roster, metrics, edit, scoring,
    and scanning. `LEAD`/`VOLUNTEER` role alone is insufficient.
-   Form schema changes after registrations exist must either be blocked
    or versioned. Never reinterpret old responses using a changed schema
    without retaining the original schema version.
-   Add tests proving Lead A cannot access Event B by changing a URL ID,
    and a Volunteer cannot edit metadata or access payment evidence.

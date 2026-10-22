# TASK 05: Public Pass Catalog, Event Discovery & Leaderboards

## Objective

Implement public-facing catalog endpoints for festival passes, event
discovery with multi-parameter filtering, search, pagination, live seat
calculations, and public tournament scoreboards with automated round
tie-breaking.

------------------------------------------------------------------------

## 1. Pass Catalog & Global Notices (`src/routes/catalog.ts`)

-   **Endpoint:** `GET /api/catalog/passes`
-   **Auth:** Public (None)
-   **Logic:**
    1.  Reads `gate_pass_price_paise`, `gate_pass_student_price_paise`,
        `purchases_enabled` from the `settings` table.
    2.  Queries `fest_days` table ordered by `day_number ASC`.
-   **Response:** Returns general and student gate pass prices, festival
    dates, and purchasing status.

------------------------------------------------------------------------

## 2. Public Event Discovery (`src/routes/events.ts`)

-   **Endpoint:** `GET /api/events`
-   **Auth:** Public (None)
-   **Query Parameters (Zod Schema):**
    -   `category?: EventCategory`
    -   `day?: number` (1, 2, or 3)
    -   `is_team?: boolean`
    -   `search?: string` (case-insensitive search on title and
        description)
    -   `cursor?: string` (base64 cursor for pagination)
    -   `limit?: number` (default 20, max 50)
-   **Execution Logic:**
    1.  Use the current source's event status semantics. Public
        visibility and registration eligibility are distinct: do not
        rename `OPEN` to `PUBLISHED` without a deliberate compatibility
        mapping. Hide drafts and non-public events according to the
        current API contract; only statuses explicitly intended to be
        publicly discoverable may appear.
    2.  Apply SQL filters dynamically using Drizzle's `and(...)`
        conditions.
    3.  Order by `fest_day ASC`, `id ASC`.
    4.  Compute computed fields:
        -   `seats_remaining = Math.max(0, capacity - seats_taken)`
        -   `registration_open` must use the current source's
            registration status rules, available capacity (treat
            nullable capacity as unbounded), registration
            opening/closing times, and any event-specific restrictions.
            Do not copy the `PUBLISHED` sample status unless the
            migration explicitly maps it.
-   **Response:**
    `{ events: PublicEventResponse[], next_cursor: string | null }`

------------------------------------------------------------------------

## 3. Single Event Retrieval (`src/routes/events.ts`)

-   **Endpoint:** `GET /api/events/:idOrSlug`
-   **Auth:** Public (None)
-   **Logic:**
    1.  Query event by UUID or unique `slug`.
    2.  For non-public/draft events, return `404 NOT_FOUND` unless the
        caller is authorized for that event (SUPER_ADMIN or assigned
        event staff as permitted by the current contract). Do not let a
        staff role alone reveal every event's private details.
    3.  Include `form_schema` (custom dynamic questions) if configured.
-   **Response:** Full `PublicEventResponse` with live
    `seats_remaining`.

------------------------------------------------------------------------

## 4. Public Tournament Leaderboard (`src/routes/leaderboards.ts`)

-   **Endpoint:** `GET /api/leaderboards/:eventId`

-   **Auth:** Public (None)

-   **Business Invariant:** Scoring and leaderboards are strictly
    restricted to events with `category = 'E_SPORTS'`.

-   **Execution Logic:**

    1.  Fetch event: verify `category === 'E_SPORTS'` and
        `leaderboard_public === 1`. If not public, return
        `403 LEADERBOARD_NOT_PUBLIC`.
    2.  Fetch all scores from `esports_scores` for this event joined
        with `registrations`, `teams`, and `users`.
    3.  Aggregate scores per participant/team:
        -   Compute `total_score` across all rounds.
        -   Collect individual round scores in an array for
            tie-breaking.
    4.  **Tie-Breaking Algorithm:**
        -   Sort primarily by `total_score DESC`.
        -   If tied, compare the highest single round score.
        -   If still tied, compare the second-highest round score, and
            so on.
    5.  Assign integer ranks (`rank: 1, 2, 3...`) handling ties
        appropriately.

-   **Response:**

    ``` json
    {
      "event": { "id": "...", "title": "Valorant Tournament", "scoring_status": "FINALIZED" },
      "leaderboard": [
        { "rank": 1, "participant_name": "Team Phoenix", "total_score": 45, "rounds": [15, 15, 15] },
        { "rank": 2, "participant_name": "Team Alpha", "total_score": 42, "rounds": [12, 15, 15] }
      ]
    }
    ```

------------------------------------------------------------------------

## Verification Checklist

-   [ ] `GET /api/catalog/passes` returns live pass pricing.
-   [ ] `GET /api/events` hides draft events and correctly filters by
    category, day, and solo/team.
-   [ ] `seats_remaining` is correctly computed as
    `capacity - seats_taken`.
-   [ ] Accessing a non-esports leaderboard returns `400 BAD_REQUEST`.
-   [ ] Leaderboard ranks break ties accurately using highest individual
    round scores.

## Mandatory event/form requirements

-   Validate event `form_schema` on event create/update, not only when a
    participant submits answers. Reject malformed JSON and invalid field
    definitions; never silently skip validation because a `try/catch`
    swallowed a parse error.
-   Public event responses may expose the form definition for a public
    event, but must not expose internal staff notes, payment reviewer
    notes, private operational fields, or participant responses.
-   A form schema must have stable unique field IDs, supported types,
    labels, required flags, and type-specific constraints/options. The
    same schema definition must be used consistently by the participant
    UI contract and backend validator.
-   Do not assume the seed importer has preserved every event field.
    Check `event_format` and all event JSON fields against normalized
    columns/metadata.
-   Ensure categories include `INTERACTIVE`, `RECREATIONAL`, and
    `SHOWCASE`, and preserve current status vocabulary unless a tested
    mapping is approved.

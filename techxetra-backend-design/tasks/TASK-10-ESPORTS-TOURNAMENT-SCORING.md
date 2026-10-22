# TASK 10: E-Sports Tournament Scoring & Optimistic Concurrency

## Objective

Implement e-sports tournament scoring, optimistic concurrency versioning
to prevent simultaneous overwrite conflicts, immutable append-only score
history, and tournament finalization.

------------------------------------------------------------------------

## 1. Domain Constraints & Invariants

1.  **Category Restriction:** Scoring is strictly allowed **only** for
    events where `category = 'E_SPORTS'`. Attempting to score any
    non-esports event must throw `400 BAD_REQUEST`.
2.  **Scoring Status:** Scores can only be entered, modified, or deleted
    when `scoring_status === 'OPEN'`. Once finalized, modifications are
    blocked.
3.  **Staff Permissions:** Must be an assigned Event Lead or Super
    Admin. Volunteers may record scores only if
    `event.volunteers_can_score === 1`.

------------------------------------------------------------------------

## 2. Optimistic Concurrency & Score Updates (`src/services/esports.service.ts`)

To prevent two coordinators from overwriting each other's score edits
simultaneously: \* Each score record in `esports_scores` has an integer
`version` column (starts at 1). \* When updating an existing score, the
client supplies `expected_version`. \* The update checks
`WHERE version = expected_version` and increments
`version = version + 1`. If 0 rows were updated, throw
`409 SCORE_VERSION_CONFLICT`.

``` ts
// Drizzle optimistic concurrency pattern
const [existing] = await tx
  .select()
  .from(esportsScores)
  .where(and(
    eq(esportsScores.eventId, eventId),
    eq(esportsScores.registrationId, registrationId),
    eq(esportsScores.roundNo, roundNo)
  ))

if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
  throw new AppError(409, 'SCORE_VERSION_CONFLICT', 'Score was updated by another coordinator. Please refresh.')
}
```

------------------------------------------------------------------------

## 3. Append-Only Score History

Every score addition, modification, or deletion must be permanently
logged in `esports_score_history`: \* `score_id`, `event_id`,
`registration_id`, `round_no`, `old_score`, `new_score`, `actor_id`,
`created_at`. \* Never delete or mutate rows from
`esports_score_history`.

------------------------------------------------------------------------

## 4. Endpoints (`src/routes/staff-esports.ts`)

-   **`POST /api/staff/events/:id/scores`**:
    -   Auth: Assigned event staff or Super Admin.
    -   Schema:
        `{ registration_id: string, round_no: number, score: number, expected_version?: number }`
    -   Inserts or updates round score, increments version, and logs
        history.
-   **`DELETE /api/staff/events/:id/scores/:scoreId`**:
    -   Deletes a score record, logs history, and recalculates
        standings.
-   **`POST /api/staff/events/:id/finalize`**:
    -   Auth: Assigned Event Lead or Super Admin.
    -   Sets `scoring_status = 'FINALIZED'`.
-   **`POST /api/staff/events/:id/reopen`**:
    -   Sets `scoring_status = 'OPEN'`.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Scoring a non-esports event returns `400 BAD_REQUEST`.
-   [ ] Submitting a score with an outdated `expected_version` fails
    with `409 SCORE_VERSION_CONFLICT`.
-   [ ] Modifying scores when `scoring_status = 'FINALIZED'` is blocked.
-   [ ] Every score edit creates an immutable entry in
    `esports_score_history`.

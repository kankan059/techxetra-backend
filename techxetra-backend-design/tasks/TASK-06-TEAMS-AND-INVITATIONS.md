# TASK 06: Team Roster Management & In-App Invitations

## Objective

Implement team formation for group events, roster capacity constraints,
team state transitions (`DRAFT` $\rightarrow$ `LOCKED` $\rightarrow$
`CONFIRMED`), in-app dashboard invitations, invitation responses, and
pre-checkout roster validation.

------------------------------------------------------------------------

## 1. Important Design Clarification: In-App Invitations

-   **No External Emails:** Invitations are not dispatched as external
    email messages.
-   **Website Dashboard Delivery:** Invitations are stored directly in
    the `team_members` database table with the invitee's email.
-   When the invited attendee logs into the TechXetra website (or
    registers an account with that email), the pending invitation
    appears on their user dashboard (`GET /api/team-invites/mine`).
-   The invitee can click **Accept** or **Decline** directly from their
    website interface.

------------------------------------------------------------------------

## 2. Team State Machine (`src/services/team.service.ts`)

       [Leader creates team]
                │
                ▼
            ┌───────┐
            │ DRAFT │ ◄── [Add/Remove members, Accept/Decline invites]
            └───┬───┘
                │ [Leader reserves passes at checkout]
                ▼
            ┌────────┐
            │ LOCKED │ ─── [15-min reservation expires or cancelled] ──► DRAFT
            └───┬────┘
                │ [Payment approved by Admin]
                ▼
           ┌───────────┐
           │ CONFIRMED │
           └───────────┘

------------------------------------------------------------------------

## 3. Team Endpoints (`src/routes/teams.ts`)

### 3.1 Create Team

-   **Endpoint:** `POST /api/teams`
-   **Auth:** `requireAuth()`, `requireProfileComplete()`
-   **Schema:** `{ event_id: string, name: string (2-50 chars) }`
-   **Execution Flow:**
    1.  Validate event exists, `is_team === 1`, and registration is
        open.
    2.  Verify caller is not already leading an active team for this
        event.
    3.  Verify team name is not taken for this event (`lower(name)`
        uniqueness).
    4.  Verify leader does not already have an active registration or
        accepted membership in another team for this event.
    5.  Insert team (`status: 'DRAFT'`).
    6.  Insert leader in `team_members` (`role: 'LEADER'`,
        `status: 'ACCEPTED'`, `user_id = caller.id`).
-   **Response:** `201 Created` with full team and member details.

### 3.2 List My Teams & Team Details

-   **`GET /api/teams/mine`**: Returns all teams where the user is
    leader or has an accepted/pending invite.
-   **`GET /api/teams/:id`**: Returns team and member roster. If caller
    is neither a member nor fest staff, return `404 NOT_FOUND` to
    protect privacy.

### 3.3 Send Team Invitation

-   **Endpoint:** `POST /api/teams/:id/invite`
-   **Auth:** `requireAuth()`
-   **Schema:** `{ email: string }`
-   **Execution Flow:**
    1.  Caller must be the team leader. Team must be in `DRAFT` status.
    2.  Check roster limit:
        `accepted_count + invited_count < event.max_team_size`.
    3.  Normalize invitee email to lowercase.
    4.  Check if email is already invited or accepted in this team.
    5.  Check if email belongs to an existing user who is already
        accepted in another team for this event.
    6.  Insert row into `team_members` (`status: 'INVITED'`,
        `invited_email: email`). If a user with this email already
        exists in `users`, link their `user_id`.
-   **Response:** `200 OK` Updated team with roster.

### 3.4 Remove Team Member / Leave Team

-   **Endpoint:** `DELETE /api/teams/:id/members/:memberId`
-   **Auth:** `requireAuth()`
-   **Logic:**
    -   Team must be in `DRAFT` status.
    -   Leader can remove any member (except themselves).
    -   Non-leader member can only remove their own record (leaving the
        team).
    -   Updates member status to `REMOVED`.

### 3.5 Disband Team

-   **Endpoint:** `DELETE /api/teams/:id`
-   **Auth:** `requireAuth()`
-   **Logic:** Team must be `DRAFT` and caller must be the leader. Sets
    `status = 'CANCELLED'`.

------------------------------------------------------------------------

## 4. In-App Invitation Response Endpoints (`src/routes/team-invites.ts`)

### 4.1 View Pending Invites

-   **Endpoint:** `GET /api/team-invites/mine`
-   **Auth:** `requireAuth()`
-   **Logic:** Query `team_members` joined with `teams` and `events`
    where `(user_id = caller.id OR invited_email = caller.email)` and
    `status = 'INVITED'`.
-   **Response:** Array of pending invitations with team and event
    details.

### 4.2 Accept / Decline Invite

-   **`POST /api/team-invites/:memberId/accept`**:
    -   Auth: `requireAuth()`, `requireProfileComplete()`.
    -   Verifies caller email matches invitation.
    -   Verifies team is in `DRAFT` and team size limit is not exceeded.
    -   Verifies caller does not already belong to another team for this
        event.
    -   Sets `status = 'ACCEPTED'`, `user_id = caller.id`,
        `responded_at = now`.
-   **`POST /api/team-invites/:memberId/decline`**:
    -   Sets `status = 'REJECTED'`, `responded_at = now`.

------------------------------------------------------------------------

## 5. Pre-Checkout Validation Service (`validateTeamForPurchase`)

Called before booking team passes: 1. Team must be in `DRAFT` status. 2.
Caller must be the team leader. 3. Accepted member count must satisfy:
`min_team_size <= count <= max_team_size`. 4. All accepted members must
have completed profiles (`profile_completed_at IS NOT NULL`). 5. No
member can already be registered for this event.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] Team creation automatically makes caller `LEADER` with
    `ACCEPTED` status.
-   [ ] Inviting a member adds a record to `team_members` without
    sending an external email.
-   [ ] Pending invitations appear in the invitee's
    `GET /api/team-invites/mine` dashboard.
-   [ ] Incomplete profiles are rejected from accepting team invites.
-   [ ] Roster limits (`min_team_size` and `max_team_size`) are strictly
    enforced.

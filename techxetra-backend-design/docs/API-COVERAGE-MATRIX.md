# API Coverage Matrix (Implementation Checklist)

The detailed request/response contracts in `API-ROUTES-AND-CONTRACTS.md` are canonical. This matrix prevents a coding agent from implementing only the public happy path. Every row must be implemented, documented in OpenAPI, validated, authorized, and tested.

| Area | Required endpoints |
|---|---|
| Health | `GET /health`, `GET /ready` |
| Public festival/catalog | `GET /festival`, `GET /events`, `GET /events/:eventIdOrSlug`, `GET /events/:eventIdOrSlug/leaderboard` (when public) |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/google` if Google enabled, `POST /auth/logout`, `GET /auth/session`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/verify-email` |
| Profile | `GET /me`, `PATCH /me`, `GET /me/registrations`, `GET /me/teams`, `GET /me/purchases`, `GET /me/tickets` |
| Teams | `POST /teams`, `GET /teams`, `GET /teams/:teamId`, `PATCH /teams/:teamId`, `DELETE /teams/:teamId`, `POST /teams/:teamId/invitations`, `GET /team-invitations/mine`, `POST /team-invitations/:invitationId/accept`, `POST /team-invitations/:invitationId/decline`, `DELETE /teams/:teamId/members/:memberId` |
| Purchase | `POST /purchases`, `GET /purchases`, `GET /purchases/:purchaseId`, `POST /purchases/:purchaseId/cancel`, `GET /purchases/:purchaseId/payment`, `POST /purchases/:purchaseId/payment-submissions`, `POST /purchases/:purchaseId/payment-submissions/:submissionId/withdraw` if withdrawal policy enabled |
| Payment admin | `GET /admin/payments`, `GET /admin/payments/:submissionId`, `POST /admin/payments/:submissionId/decision` — Super Admin only |
| Ticket owner | `GET /tickets`, `GET /tickets/:ticketId` |
| Scanner | `POST /staff/scan/lookup`, `POST /staff/scan/check-in`, `GET /staff/events/:eventId/check-ins` |
| Staff events | `GET /staff/events`, `GET /staff/events/:eventId/dashboard`, `GET /staff/events/:eventId/participants`, `GET /staff/events/:eventId/registrations/:registrationId`, `PATCH /staff/events/:eventId/public-details`, `GET /staff/events/:eventId/leaderboard` |
| E-sports staff | `GET /staff/events/:eventId/matches`, `POST /staff/events/:eventId/matches`, `PUT /staff/events/:eventId/matches/:matchId/result`, `POST /staff/events/:eventId/scoring/finalize`, `POST /staff/events/:eventId/scoring/reopen` |
| Admin users | `GET /admin/users`, `GET /admin/users/:userId`, `PATCH /admin/users/:userId` |
| Admin events | `GET /admin/events`, `POST /admin/events`, `GET /admin/events/:eventId`, `PATCH /admin/events/:eventId`, `POST /admin/events/:eventId/publish`, `POST /admin/events/:eventId/cancel`, `GET /admin/events/:eventId/staff`, `PUT /admin/events/:eventId/staff/:userId`, `DELETE /admin/events/:eventId/staff/:userId`, `PUT /admin/events/:eventId/form-schema` |
| Admin purchases/registrations | `GET /admin/purchases`, `GET /admin/purchases/:purchaseId`, `POST /admin/purchases/:purchaseId/retry-fulfillment`, `GET /admin/registrations`, `POST /admin/registrations/:registrationId/cancel` |
| Admin tickets | `POST /admin/tickets/:ticketId/revoke`, `POST /admin/tickets/:ticketId/rotate-qr`, `POST /admin/tickets/:ticketId/undo-check-in` |
| Admin reports/audit/settings | `GET /admin/reports/summary`, `GET /admin/reports/financial`, `GET /admin/reports/attendance`, `GET /admin/audit-logs`, `PATCH /admin/settings/:key`, `PUT /admin/festival-days/:dayNumber` |

## Every endpoint must specify

- Authentication requirement and role(s).
- For staff routes: active event assignment and scope checks.
- Path/query/body validation, unknown-field behavior, maximum lengths, pagination bounds, and allowed sorting/filtering.
- Success HTTP status and response schema using the standard envelope.
- Stable error code and HTTP status for expected failures.
- Transactional side effects, audit events, and idempotency requirements.
- Whether private data is returned and the role-specific DTO used.

## Standard response examples

Success:
```json
{"data":{"id":"uuid","status":"OPEN"},"meta":{"requestId":"req_123"}}
```

Paginated:
```json
{"data":[],"meta":{"requestId":"req_123","page":1,"pageSize":20,"total":0,"totalPages":0}}
```

Validation error:
```json
{"error":{"code":"VALIDATION_ERROR","message":"Request validation failed","details":[{"path":"email","message":"Invalid email address"}]},"meta":{"requestId":"req_123"}}
```

Any additional supporting routes must be documented in the API
registry, coverage matrix, and OpenAPI specification. Do not add
payment-evidence upload/download routes or undocumented external
service integrations.

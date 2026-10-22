# TASK 03: Core Middlewares, Error Handlers & Health Check

## Objective

Implement foundational Express middlewares for request tracing,
structured logging with sensitive data redaction, standardized API
response envelopes, centralized PostgreSQL/Zod error handling, CSRF
mutation origin checks, and health endpoints.

------------------------------------------------------------------------

## 1. Request Context & Type Definitions (`src/types/express.d.ts`)

Extend the Express `Request` interface so all handlers have access to
the authenticated user and request ID:

``` ts
import { User, Session } from '../db/schema'

declare global {
  namespace Express {
    interface Request {
      requestId: string
      now: number
      user?: User
      session?: Session
    }
  }
}
```

------------------------------------------------------------------------

## 2. Standard API Response Envelopes (`src/common/response.ts`)

All API endpoints must respond with the standard JSON envelope matching
the frontend expectations:

-   **Success (`200 OK`, `201 Created`):**

    ``` json
    {
      "success": true,
      "data": { ... },
      "request_id": "c1f7b8c2-3e4a-4b9d-8c1e-9f0a1b2c3d4e"
    }
    ```

-   **Error (`4xx`, `5xx`):**

    ``` json
    {
      "success": false,
      "error": {
        "code": "VALIDATION_ERROR",
        "message": "Human-readable description",
        "details": [ ... ]
      },
      "request_id": "c1f7b8c2-3e4a-4b9d-8c1e-9f0a1b2c3d4e"
    }
    ```

Create helper utility functions: \*
`sendSuccess(res, data, statusCode = 200)` \*
`sendError(res, code, message, statusCode = 400, details = [])`

------------------------------------------------------------------------

## 3. Centralized Application Errors & Error Mapper (`src/common/errors.ts`)

1.  Define `AppError` class extending `Error`:
    -   `statusCode: number`
    -   `code: string` (e.g. `UNAUTHORIZED`, `FORBIDDEN`,
        `CAPACITY_FULL`, `NOT_FOUND`)
    -   `details?: any`
2.  Create an Express error middleware
    (`src/middleware/error-handler.ts`):
    -   Catches `ZodError` $\rightarrow$ returns `400 VALIDATION_ERROR`
        with path and message details.
    -   Catches `AppError` $\rightarrow$ returns `statusCode` with
        matching `code` and `message`.
    -   Catches PostgreSQL Error Codes:
        -   `23505` (unique_violation) $\rightarrow$ returns
            `409 CONFLICT` or domain-specific code.
        -   `23503` (foreign_key_violation) $\rightarrow$ returns
            `400 BAD_REQUEST`.
        -   `23514` (check_violation) $\rightarrow$ returns
            `400 BAD_REQUEST`.
    -   Unhandled errors $\rightarrow$ returns
        `500 INTERNAL_SERVER_ERROR`.

------------------------------------------------------------------------

## 4. Security Middlewares (`src/middleware/security.ts` & `cors.ts`)

1.  **Request ID Middleware:**
    -   Extracts `X-Request-Id` or generates a new UUID v4.
    -   Attaches `req.requestId` and `req.now = Date.now()`.
    -   Sets `X-Request-Id` response header.
2.  **CORS Middleware:**
    -   Validates `Origin` header against `env.FRONTEND_ORIGIN`.
    -   Supports `credentials: true`.
3.  **Helmet Middleware:**
    -   Configures CSP (`default-src 'none'`),
        `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
4.  **Mutation Origin Check (CSRF Protection):**
    -   For state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`),
        strictly verifies that the `Origin` or `Referer` matches
        `env.FRONTEND_ORIGIN`. Rejects spoofed cross-origin requests
        with `403 CSRF_ORIGIN_INVALID`.
5.  **Redacted Structured Logger (`src/common/logger.ts`):**
    -   Formats JSON logs.
    -   Automatically redacts sensitive fields: `password`, `token`,
        `transaction_id`, `phone`, `id_token`.

------------------------------------------------------------------------

## 5. Health & Readiness Routes (`src/routes/health.ts`)

Mount at `/` and `/api`: \* `GET /health`: Returns `{ status: "ok" }`.
\* `GET /ready`: Executes `await db.execute(sql`SELECT 1`)`. If
connected, returns `{ status: "ready", database: "connected" }`. If
failed, returns `503 Service Unavailable`.

------------------------------------------------------------------------

## Verification Checklist

-   [ ] `GET /health` returns `200 OK` with JSON envelope.
-   [ ] `GET /ready` checks PostgreSQL connection and returns `200 OK`.
-   [ ] Cross-origin mutation without matching origin header returns
    `403 CSRF_ORIGIN_INVALID`.
-   [ ] Zod validation errors return formatted `400 VALIDATION_ERROR`.
-   [ ] Sensitive fields (passwords, tokens) are never printed in
    console logs.

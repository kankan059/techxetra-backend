# TASK 01: Project Setup, Node.js, Express & Environment Configuration

## Objective

Set up the Node.js TypeScript project structure, configure Express with
TypeScript, set up Drizzle ORM and PostgreSQL connection pooling, create
Docker Compose for local development, and implement strict environment
variable validation.

------------------------------------------------------------------------

## 1. Dependencies to Install

### Production Dependencies (`dependencies`):

-   `express` (@types/express): Core web framework.
-   `drizzle-orm`: Type-safe TypeScript ORM for PostgreSQL.
-   `pg` (@types/pg): PostgreSQL client driver with native connection
    pooling.
-   `zod`: Strict schema validation for request payloads and environment
    variables.
-   `cors` (@types/cors): Cross-Origin Resource Sharing.
-   `helmet`: Security HTTP headers (Content Security Policy,
    X-Frame-Options, HSTS).
-   `cookie-parser` (@types/cookie-parser): Cookie parsing middleware.
-   `jose`: JWT verification for Google OAuth ID tokens.
-   `uuid` (@types/uuid): UUID v4 generation.
-   `dotenv`: Environment variable loading for local development.

### Development Dependencies (`devDependencies`):

-   `typescript`: Strict mode TypeScript compiler.
-   `drizzle-kit`: CLI for generating and applying PostgreSQL
    migrations.
-   `tsx`: Ultra-fast TypeScript execution for development
    (`tsx watch src/server.ts`).
-   `vitest` / `supertest`: Integration testing framework.

------------------------------------------------------------------------

## 2. Strict Environment Variable Validation (`src/config/env.ts`)

Create a Zod schema to parse and validate `process.env` at server
startup. The server must throw an error and refuse to boot if any
required environment variable is missing or malformed:

``` ts
import { z } from 'zod'

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(5),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  GOOGLE_CLIENT_ID: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url(),
  TICKET_HMAC_SECRET: z.string().min(32),
  UPI_VPA: z.string().min(3),
  UPI_PAYEE_NAME: z.string().min(2),
  PURCHASE_RESERVATION_TTL_MS: z.coerce.number().default(900000), // 15 mins
  PARTICIPANT_SESSION_TTL_MS: z.coerce.number().default(2592000000), // 30 days
  STAFF_SESSION_TTL_MS: z.coerce.number().default(43200000), // 12 hours
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
})

export type Env = z.infer<typeof envSchema>
export const env = envSchema.parse(process.env)
```

------------------------------------------------------------------------

## 3. Database Connection & Drizzle Initialization (`src/db/index.ts`)

Configure `pg.Pool` with connection pooling limits, connection error
handling, and graceful teardown:

``` ts
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../config/env'
import * as schema from './schema'

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DATABASE_POOL_MIN,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

export const db = drizzle(pool, { schema })
```

------------------------------------------------------------------------

## 4. Docker Compose for Local Database (`docker-compose.yml`)

Create a root `docker-compose.yml` to spin up PostgreSQL 16 locally with
a persistent volume and automated health check:

``` yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: techxetra_postgres
    restart: always
    environment:
      POSTGRES_USER: techxetra
      POSTGRES_PASSWORD: techxetra_password
      POSTGRES_DB: techxetra_db
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U techxetra -d techxetra_db"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

------------------------------------------------------------------------

## 5. Express Application Bootstrap (`src/app.ts` & `src/server.ts`)

-   `src/app.ts`: Initializes Express, attaches JSON parser, URL-encoded
    parser, cookie parser, Helmet, CORS, and request ID middleware.
-   `src/server.ts`: Starts listening on `env.PORT`. Implements graceful
    shutdown on `SIGINT` and `SIGTERM` (closes HTTP server and pool
    cleanly).

------------------------------------------------------------------------

## Verification Checklist

-   [ ] `npm run dev` boots the Express server without errors.
-   [ ] Docker Compose starts PostgreSQL 16 and passes the health check.
-   [ ] `DATABASE_URL` connectivity is verified.
-   [ ] Invalid or missing environment variables cause the process to
    fail immediately with helpful Zod errors.

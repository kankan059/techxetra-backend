# TechXetra Backend

This is the backend for the TechXetra application.

## Requirements

Install these first:

-   Node.js and npm
-   Docker Desktop or Docker Engine
-   The backend source code

## 1. Install packages

Open a terminal in the backend folder and run:

``` bash
npm ci
```

## 2. Start the local database

The project includes a Docker Compose file for PostgreSQL.

``` bash
docker compose up -d postgres
```

This starts a local database on port `5432`.

Default local database details:

-   Database: `techxetra_db`
-   Username: `techxetra`
-   Password: `techxetra_password`
-   Host: `localhost`
-   Port: `5432`

These credentials are for local development only.

## 3. Create the `.env` file

Create a file named `.env` in the backend folder and add:

``` dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://techxetra:techxetra_password@localhost:5432/techxetra_db
FRONTEND_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=dummy-google-client-id
TICKET_HMAC_SECRET=techxetra_secure_hmac_secret_at_least_32_characters_long
SESSION_SECRET=techxetra_session_secret_for_cookies_or_csrf_32_chars
SUPER_ADMIN_EMAIL=admin@techxetra.in
SUPER_ADMIN_PASSWORD=LocalDevAdminPassword123!
```

These values are examples for local development. Do not use them in
production.

Google sign-in will not work with the dummy Google client ID. Use a real
Google OAuth client ID if you need to test Google sign-in.

Never commit your `.env` file or share real secrets.

## 4. Create or update the database tables

Run:

``` bash
npm run db:migrate
```

## 5. Add local seed data (optional)

Run:

``` bash
npm run db:seed
```

The seed command needs `SUPER_ADMIN_PASSWORD` to be at least 10
characters long.

The seed script also looks for the event catalog file at:

``` text
techxetra-backend-design/techxetra_2026_events.json
```

If that file is missing, event data will be skipped. Check the seed
script and database before running it against any shared or production
database.

## 6. Start the backend

For development:

``` bash
npm run dev
```

The backend runs on port `4000` by default.

Check the health endpoint at:

``` text
http://localhost:4000/health
```

The API is mounted under:

``` text
http://localhost:4000/api/v1
```

Some routes are also mounted at the root path. Check the route files for
the exact paths.

## Other useful commands

Build the project:

``` bash
npm run build
```

Run the built server:

``` bash
npm start
```

Run tests:

``` bash
npm test
```

Open Drizzle Studio:

``` bash
npm run db:studio
```

Generate a migration:

``` bash
npm run db:generate
```

Push the schema directly to the database:

``` bash
npm run db:push
```

Use migrations for the normal team workflow. Only use `db:push` when you
understand the changes it will make.

## Connect the frontend

The frontend must use the correct backend URL and API path.

-   Backend base URL: `http://localhost:4000`
-   Versioned API base: `http://localhost:4000/api/v1`
-   Frontend origin by default: `http://localhost:3000`

The frontend must send credentials for cookie-based requests. Its origin
must match `FRONTEND_ORIGIN`.

Do not assume every endpoint starts with `/api`. Confirm the route path
in the backend before wiring it up.

## Before sharing with teammates

Share:

-   The backend source code
-   This README
-   The package lockfile
-   Any required seed files
-   A safe `.env.example` file with no real secrets

Each teammate should create their own `.env` file.

Never share production passwords, API secrets, session secrets, or
database credentials in chat or source control.

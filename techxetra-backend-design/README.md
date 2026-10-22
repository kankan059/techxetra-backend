# TechXetra Greenfield Backend — Complete Design and Agent Handoff Pack

This is the authoritative, frontend-independent specification for building a new backend with **Node.js LTS, TypeScript, Express, PostgreSQL, and Drizzle ORM**. The old Hono/Cloudflare Workers/D1/SQLite runtime is not required and must not be copied.

## Read these first, in order
1. `GREENFIELD-BACKEND-SPEC.md` — overall target, architecture, and acceptance criteria.
2. `docs/CAPABILITY-CROSSWALK-AND-LATEST-FIXES.md` — preserved capabilities and fixes; precedence rules.
3. `docs/DATABASE-SCHEMA.md` — target PostgreSQL schema, relationships, constraints, and indexes.
4. `docs/API-ROUTES-AND-CONTRACTS.md` — detailed routes, payloads, roles, response envelopes, and behavior.
5. `docs/API-COVERAGE-MATRIX.md` — endpoint checklist; no route family may be omitted.
6. `docs/BUSINESS-WORKFLOWS.md` — state transitions, transaction boundaries, and failure recovery.
7. `docs/DECISIONS-AND-OPEN-CHOICES.md` — fixed decisions and choices that must be explicitly documented.
8. `docs/SEED-DATA-MAPPING.md` — event JSON import rules.
9. `structure/` — historical domain references retained from the previous documentation; use only to discover capabilities, never as authority where conflicts exist.
10. `tasks/TASK-01` through `tasks/TASK-13` — detailed implementation instructions; execute in order.

## Non-negotiable instructions for the coding agent
- Do not inspect or depend on old `/src` implementation code. It is intentionally excluded from the pack.
- Do not implement Hono, Cloudflare Workers, D1, SQLite, or Wrangler.
- Implement all required route families, not just a minimal demo. Keep migrations, Drizzle schema, OpenAPI, tests, and docs synchronized.
- Latest decisions override any conflicting historical `structure/*-LEGACY-REFERENCE.md` content. In particular, **only Super Admin can review payments**.
- Do not silently drop seed rows or fields. Provide a dry-run and a reproducible import report.
- Keep the application runnable after each task. Run actual tests/typecheck/build/migrations and report exact outcomes honestly.
- Never leave payment, ticket, check-in, authorization, capacity, or account-linking logic as TODOs or mocks.
- Where a decision is intentionally open, make a secure choice and document it in `docs/DECISIONS.md`. If an ambiguity can change money, access, identity, or admission outcomes, call it out before implementing that behavior.

## Suggested agent prompt
> Implement this as a new Express + TypeScript + PostgreSQL + Drizzle backend. Read this pack in the listed order. Treat the schema, route contracts, capability crosswalk, and workflows as requirements. Do not inspect or rely on the legacy `/src` code. Execute tasks 01–09 sequentially; implement all routes and request/response contracts; write migrations and tests alongside each feature; enforce all role and event-scope rules server-side; document permitted choices; and finish with exact commands and honest test/build/migration results. Do not declare completion with placeholder handlers or untested critical workflows.

## Deliverables
- Complete working source code, migrations, seed importer, and bootstrap-admin flow.
- `docs/openapi.yaml` covering every endpoint.
- Automated unit and integration tests, including concurrency/idempotency/security tests.
- `.env.example`, Dockerfile, docker-compose for local PostgreSQL, README, and deployment instructions.
- `docs/DECISIONS.md` documenting choices, `docs/IMPLEMENTATION-STATUS.md` mapping every route and requirement to code/tests.

The included `techxetra_2026_events.json` is seed input only. Never include `.dev.vars`, `.wrangler`, credentials, or other secrets in this pack.

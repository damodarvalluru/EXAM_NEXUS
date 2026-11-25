# Phase 1 report — Foundation

**Date:** 2026-11-21  
**Status:** Code and configuration complete. Local infrastructure runtime verification is pending
because Docker is not installed in the development environment.

## Final integrated status addendum (2026-11-25)

All Phase 1 work that can be executed locally is complete and verified: `pnpm install`, `pnpm lint`,
`pnpm test`, `pnpm build`, `prisma validate`, browser E2E and a Trivy filesystem/secret scan with zero
findings after dependency remediation. The historical Docker availability note below is preserved,
but it no longer represents the final verification state. See
[`evidence/phase-08/final-verification.md`](../../../evidence/phase-08/final-verification.md).

## TiDB Cloud migration note (2026-11-22)

The sections below are the historical Phase 1 record as written on 2026-11-21. On 2026-11-22 the
database was migrated from local PostgreSQL to TiDB Cloud Serverless (MySQL 8.0 protocol, TLS
required). The PostgreSQL `0001_init` / `0002_rls` migrations and RLS SQL were moved to
`apps/api/prisma/legacy-postgres/`; the applied baseline is now the generated MySQL migration
`20261122000000_init`. RLS claims below are no longer true of the current runtime: tenant isolation
is now application-level scoping in `PrismaService` (implementation being finalised separately).
Commands referencing a `postgres` container, `psql`, port 5432 or `prisma migrate dev` are stale;
use the current [getting-started guide](../getting-started.md) and
[setup guide](../setup-installation-guide.md).

## Final integration verification (2026-11-22)

This section supersedes the outstanding infrastructure statements in the historical record above.

- Docker Desktop/Redis were restarted; `docker exec examnexus-redis redis-cli ping` → `PONG`. Docker
  stopped again during the final worker run and was restarted once more, with `redis-cli ping` →
  `PONG` re-verified. Redis is running locally via Docker Compose.
- Applied migrations: `20261122000000_init`, `20261122120000_admin_integration_support` and
  `20261122130000_exam_integrity`. `prisma migrate status` → "Database schema is up to date!". The
  integrity migration adds frozen published-snapshot `contentHash`, attempt `versionId` binding, a
  stored submission receipt and a unique answer index; it is conditional because an earlier failed
  attempt had already added `contentHash`.
- Final checks: `pnpm lint`, `pnpm build` and
  `pnpm --filter @examnexus/api exec prisma validate` all passed; `pnpm test` passed with API
  14 suites passed / 2 skipped, 93 tests passed / 10 skipped and web 2 tests passed.
- Live DB suite with Redis running:
  `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand` → 16 suites, 103 tests passed.
- The API boots successfully. A startup DI blocker was fixed by importing `CommonModule` into
  `ExaminationsModule` so `AuditService` resolves.
- Live smoke: `/health/live` ok; `/health/ready` 200 with database up, redis up and storage up;
  `/api/v1/modules` returned 8 entries, listing phases 1–6 as implemented.
  Unauthenticated `POST /api/v1/integrations/ingest/candidates` returned 401 and
  `POST /api/v1/integrations/webhooks/inbound/<random-uuid>` returned 404 for an unknown endpoint.
  No `/api/v1/api/v1/...` double-prefixed route appears in the startup log.
- Combined fix verification: 5 suites / 50 tests passed (rate-limit, admin, organisations, auth
  security). Redis failure-counter clearing on reactivation/unlock and legacy slash-form document
  key compatibility are verified in the Phase 2 and Phase 3 sections below.
- Residual/not claimed: browser E2E automation, real third-party outbound calls, production
  alerting/on-call/SLA, paid billing provider mutations and Phases 7–8.

## Features completed

- Requirements analysis and system architecture (SaaS, multi-tenant, hybrid-ready, modular monolith).
- Four architecture decision records (monolith, RLS, exam state authority, integration gateway).
- pnpm monorepo with pinned dependencies, CI workflow, formatting and lint scripts.
- Comprehensive relational schema (all entity groups from the specification) with tenant keys,
  indexes and unique constraints.
- Two Prisma migrations: `0001_init` (tables/enums/indexes) and `0002_rls` (PostgreSQL RLS policies
  and tenant-context functions).
- NestJS API foundation: Zod env validation, configuration, Prisma and Redis services, transaction
  helper that sets RLS context, versioned REST prefix, Swagger, validation pipe, response envelope,
  request IDs, global exception filter, tenant guard, health endpoints, module-status endpoint and
  a WebSocket transport skeleton.
- React SPA foundation: premium light/dark shell, all 26 Super Admin navigation entries, routing,
  TanStack Query client, typed API client with real response envelopes, API-driven overview page
  with loading/error/empty states, validation-based login UI with an honest Phase 2 notice, and
  module placeholder pages that do not fabricate data.

## Features pending

- Phase 2: Super Admin password/PIN login, MFA, sessions, RBAC, audit logging.
- Phase 3: organisation registration/verification/dashboards.
- Phases 4–8: examination engine, integrations, analytics/security centre, advanced features and
  production verification.
- Running the local Docker stack and applying/verifying RLS against a real PostgreSQL instance.
- Load, security and cross-tenant isolation tests (require infrastructure).

## Files and modules created

```
README.md, package.json, pnpm-workspace.yaml, tsconfig.base.json, docker-compose.yml,
.env.example, .github/workflows/ci.yml, deploy/nginx/gateway.conf
docs/architecture/system-architecture.md, docs/architecture/adr/0001..0004
docs/development/{roadmap,getting-started}.md, docs/security/security-overview.md, docs/api/index.md
packages/shared/{src/{api,enums,tenant,index}.ts, package.json, tsconfig.json}
apps/api/prisma/{schema.prisma, sql/rls-policies.sql, migrations/0001_init, migrations/0002_rls}
apps/api/src/{main.ts, app.module.ts, app.controller.ts, config/, common/, database/, health/, modules/}
apps/web/src/{main.tsx, App.tsx, app/, components/ui/, config/, features/{auth,platform}/, lib/, styles/, test/}
```

## Database changes

- New schema with ~50 tables covering organisations, users/RBAC, exams/questions, candidates/
  attempts/submissions/results, integrations/webhooks, audit/security, notifications, billing,
  files and system health.
- Every tenant-scoped table has `tenant_id`; RLS policies use `app.current_tenant_id()` with an
  explicit, audited `app.is_elevated()` escape hatch reserved for Super Admin service code.
- `FORCE ROW LEVEL SECURITY` is applied so the application role cannot bypass policies.
- No live database was modified in this environment (Docker unavailable).

## APIs implemented

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1` | Platform identity |
| GET | `/api/v1/modules` | Honest backend module implementation status |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | PostgreSQL and Redis readiness with latency |
| GET | `/docs` | Generated OpenAPI/Swagger UI |
| WS | `/live` | Realtime transport skeleton (attempt channels in Phase 4) |

## Tests executed and results

| Check | Result |
| --- | --- |
| `pnpm install` | Passed (730 packages, pinned versions) |
| `prisma validate` | Passed — schema valid |
| `prisma generate` | Passed — client generated |
| `pnpm build` | Passed — shared, API and SPA built |
| `pnpm test` | Passed — 3 API unit tests, 2 SPA tests |
| `pnpm lint` | Passed — strict TypeScript, no errors |

No integration, database, load or security tests were executed because infrastructure is unavailable
locally. No result above should be read as evidence of those categories.

## Security issues identified

1. **RLS policies are unverified against a live database** — highest priority for Phase 2.
2. Dev configuration disables CSP so Swagger UI works; a nonce-based CSP is required in production.
3. `.env.example` contains placeholders only — real secrets must be generated and stored in a
   vault/KMS before any deployment.
4. The `x-tenant-slug` header is stored only as a UI hint and is deliberately not trusted; Phase 2
   must resolve tenancy exclusively from verified session claims.
5. No authentication, rate limiting or audit logging exists yet (Phase 2 scope).
6. Nest 12 was rejected because its ESM-only packages break the CommonJS Nest toolchain; the API is
   pinned to the stable Nest 11 line.

## Instructions to run

Follow [`docs/development/getting-started.md`](../getting-started.md). Summary:

```powershell
pnpm install
Copy-Item .env.example .env   # then set real secrets
docker compose up -d
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api prisma:migrate:dev   # applies 0001 + 0002 (RLS)
pnpm dev
```

# Phase 1 report — Foundation

**Date:** 2026-11-21  
**Status:** Code and configuration complete. Local infrastructure runtime verification is pending
because Docker is not installed in the development environment.

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

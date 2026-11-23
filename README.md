# ExamNexus — Enterprise Examination Platform

ExamNexus is a multi-tenant, enterprise-grade examination hosting and management platform.
It is being built as a **cloud SaaS foundation with hybrid-ready architecture**, starting as a
modular monolith and scaling out only where measurements justify it.

> **Build status (verified 2026-11-22):** Phases 1–6 are code-complete and locally verified.
> `pnpm lint`, `pnpm test` (API: 14 suites passed / 2 skipped, 93 tests passed / 10 skipped; web:
> 2 tests passed), `pnpm build` and `pnpm --filter @examnexus/api exec prisma validate` pass; the
> opt-in live database suite with Redis running passed **16 suites / 103 tests**
> (`RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand`). Migrations
> `20261122000000_init`, `20261122120000_admin_integration_support` and
> `20261122130000_exam_integrity` are applied (`prisma migrate status` → "Database schema is up to
> date!"); Redis runs locally via Docker Compose (`docker exec examnexus-redis redis-cli ping` →
> `PONG`) and the API boots with `/health/ready` reporting database, redis and storage up.
> Redis reactivation failure-counter clearing and legacy verification-document key compatibility are
> now implemented and verified. The platform includes the foundation, Super Admin auth/RBAC,
> organisation onboarding, the full examination engine with a candidate portal, the tenant
> integration/API gateway and the complete Super Admin administration suite. **This is local
> verification, not production-deployment readiness.** Real third-party outbound calls (no
> credentials), browser E2E automation, production
> alerting/escalation/on-call/SLA policies and paid-billing provider mutations/invoices remain
> unverified; Phases 7–8 are pending. See
> [`docs/development/roadmap.md`](docs/development/roadmap.md) and the
> [Phase 5](docs/development/reports/phase-05.md) and [Phase 6](docs/development/reports/phase-06.md) reports.

## Prerequisites

- Node.js >= 20.19 and pnpm 12.3.4 (pinned by `packageManager`; enable with Corepack).
- Access to the TiDB Cloud Serverless cluster (`gateway01.us-east-1.prod.aws.tidbcloud.com:4000`,
  database `examnexus`, MySQL 8.0 protocol, TLS required). Use the least-privilege application user
  for `DATABASE_URL`; the cluster root user belongs in `DIRECT_URL` for migrations only.
- Docker Desktop with Compose v2 for Redis. MinIO and MailHog are optional Compose profiles.
  There is no local database container.

## Key design commitments

- Strict tenant isolation enforced by application-level tenant scoping in `PrismaService` (database
  RLS is not available on TiDB Cloud) and by backend permission checks on every request. See
  [ADR-0002](docs/architecture/adr/0002-shared-schema-rls.md) (superseded) and the
  [TiDB Cloud tenant scoping ADR](docs/architecture/adr/0003-tidb-cloud-and-application-tenant-scoping.md).
- No fabricated metrics: dashboard data is derived from real database records.
- Server-authoritative examination timing, autosave and idempotent submission.
- Integration gateway designed as a first-class subsystem, not an afterthought.
- Honest, documented limits of browser-level anti-cheating controls.

## Repository layout

```
apps/
  api/                 NestJS API (modular monolith, REST v1 + WebSocket)
  web/                 React SPA (Vite, TanStack Query, Tailwind)
packages/
  shared/              Shared TypeScript types, enums and API contracts
docs/
  architecture/        System design and architecture decision records
  development/         Roadmap and setup guides
  security/            Threat model and security notes
  api/                 API documentation
prisma/                (under apps/api) schema and migrations
```

## Quick start

See [`docs/development/getting-started.md`](docs/development/getting-started.md) and the
[setup and installation guide](docs/development/setup-installation-guide.md).

```powershell
pnpm install
Copy-Item .env.example .env
# Fill in the TIDB_* values from your cluster: app user in DATABASE_URL, root user in DIRECT_URL.
Copy-Item .env apps\api\.env -Force
docker compose up -d
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api exec prisma migrate deploy
pnpm dev
```

`DATABASE_URL` and `DIRECT_URL` are `mysql://` URLs with `?sslaccept=strict`. Never put the cluster
root user in `DATABASE_URL`. `prisma migrate dev` cannot create a shadow database on this cluster;
the supported workflow is `prisma migrate diff` to generate SQL and `prisma migrate deploy` to apply
it. Docker is only needed for Redis (MinIO/MailHog are optional); if Docker is unavailable, point
`REDIS_URL` and object-storage variables at managed services.

## Phase deliverables

Each phase ends with a written report covering completed/pending features, files created,
database changes, APIs, tests, security findings and run instructions. Phase reports live in
[`docs/development/reports/`](docs/development/reports/).

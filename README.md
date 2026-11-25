# ExamNexus — Enterprise Examination Platform

ExamNexus is a multi-tenant, enterprise-grade examination hosting and management platform.
It is being built as a **cloud SaaS foundation with hybrid-ready architecture**, starting as a
modular monolith and scaling out only where measurements justify it.

> **Build status (verified 2026-11-25):** All internally executable work across Phases 1–8 is
> complete and verified. `pnpm install`, `pnpm lint`, `pnpm test`, `pnpm build`,
> `pnpm --filter @examnexus/api exec prisma validate` and `pnpm test:e2e` pass. API unit tests:
> **28 suites passed / 4 skipped**, **216 tests passed / 12 skipped**; web unit tests: **2 passed**;
> browser E2E: **11 passed**. Trivy v0.76.2 completed with **0 vulnerabilities and 0 secrets** after
> all dependency findings were remediated. The earlier live TiDB Cloud suite passed **19 suites /
> 114 tests**, running-API smoke checks passed **6/6**, a passive ZAP baseline recorded 0 FAIL / 1
> informational warning, corrected Semgrep scans recorded 0 findings, k6 load/spike thresholds
> passed, and an encrypted DR backup/verify/restore rehearsal recorded RPO/RTO. Migrations
> `20261122000000_init`, `20261122120000_admin_integration_support`,
> `20261122130000_exam_integrity` and `20261123000000_phase7_advanced` are applied (`prisma migrate
> status` → "Database schema is up to date!"). **This is local verification, not production
> deployment readiness.** Real third-party outbound calls, independent security review sign-off and
> an authorised penetration test remain external dependencies and are not claimed as complete. See
> the [roadmap](docs/development/roadmap.md),
> [final verification](evidence/phase-08/final-verification.md),
> [Phase 7](docs/development/reports/phase-07.md) and
> [Phase 8](docs/development/reports/phase-08.md) reports.

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
  backend/             NestJS API (modular monolith, REST v1 + WebSocket; package @examnexus/api)
  frontend/            React SPA (Vite, TanStack Query, Tailwind; package @examnexus/web)
packages/
  shared/              Shared TypeScript types, enums and API contracts
docs/
  architecture/        System design and architecture decision records
  development/         Roadmap, setup guides and phase reports
  security/            Threat model, security notes and review templates
  api/                 API documentation
tests/
  load/k6/             Candidate-flow load/spike scripts (staging only)
  security/            ZAP/Semgrep config and API smoke checks
scripts/dr/            Encrypted backup/verify/restore runbook
apps/backend/prisma/    Schema and migrations
```

## Quick start

See [`docs/development/getting-started.md`](docs/development/getting-started.md) and the
[setup and installation guide](docs/development/setup-installation-guide.md).

```powershell
pnpm install
Copy-Item .env.example .env
# Fill in the TIDB_* values from your cluster: app user in DATABASE_URL, root user in DIRECT_URL.
Copy-Item .env apps\backend\.env -Force
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

## Verification tooling

- Browser E2E: `pnpm test:e2e` — 11 Chromium journeys covering auth, organisation, candidate,
  Phase 7 and admin flows.
- Load/spike: [`tests/load/k6/README.md`](tests/load/k6/README.md) — staging only; recorded local
  results are under `evidence/phase-08/load/`.
- Security scans and API smoke checks: [`tests/security/README.md`](tests/security/README.md); Trivy
  triage is in [`evidence/phase-08/trivy-triage.md`](evidence/phase-08/trivy-triage.md).
- Disaster recovery CLI/runbook: [`scripts/dr/README.md`](scripts/dr/README.md) — backup, verify and
  restore rehearsal evidence is under `evidence/phase-08/dr/`.
- Penetration test plan and independent review template: [`docs/security/`](docs/security/) — both
  remain unsigned pending an independent reviewer and authorised test window.

Evidence from executed verification is under `evidence/phase-08/`.

## Phase deliverables

Each phase ends with a written report covering completed/pending features, files created,
database changes, APIs, tests, security findings and run instructions. Phase reports live in
[`docs/development/reports/`](docs/development/reports/).

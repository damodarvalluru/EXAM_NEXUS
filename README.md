# ExamNexus — Enterprise Examination Platform

ExamNexus is a multi-tenant, enterprise-grade examination hosting and management platform.
It is being built as a **cloud SaaS foundation with hybrid-ready architecture**, starting as a
modular monolith and scaling out only where measurements justify it.

> **Build status:** Phase 1 — Foundation (in progress).
> This repository currently contains architecture, schema, project scaffolding and core
> infrastructure. Feature modules are implemented phase by phase; see
> [`docs/development/roadmap.md`](docs/development/roadmap.md).

## Key design commitments

- Strict tenant isolation enforced in PostgreSQL (Row-Level Security) and in every backend request.
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

## Quick start (Phase 1)

See [`docs/development/getting-started.md`](docs/development/getting-started.md).

```powershell
pnpm install
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api prisma:migrate:dev
pnpm dev
```

Docker Desktop is required for the local PostgreSQL/Redis/MinIO stack. If Docker is unavailable,
point `DATABASE_URL`, `REDIS_URL` and object-storage variables at managed services.

## Phase deliverables

Each phase ends with a written report covering completed/pending features, files created,
database changes, APIs, tests, security findings and run instructions. Phase reports live in
[`docs/development/reports/`](docs/development/reports/).

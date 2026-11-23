# Getting started

For the complete one-time installation and configuration walkthrough, see
[setup-installation-guide.md](./setup-installation-guide.md).

## Prerequisites

- Node.js ≥ 20.19 (Node 24 used during development)
- pnpm 12.3.4 (pinned by `packageManager`; enable it with Corepack)
- Access to the TiDB Cloud Serverless cluster
  (`gateway01.us-east-1.prod.aws.tidbcloud.com:4000`, database `examnexus`, MySQL 8.0 protocol,
  TLS required). The runtime API uses a least-privilege app user; migrations use the cluster root
  user via `DIRECT_URL`. Never use the root user from the API.
- Docker Desktop with Compose v2 for Redis (MinIO and MailHog are optional Compose profiles).
  There is no local database container. Verification documents use local disk storage in Phases 2–3;
  an S3 adapter is planned later.

## Install and run

```powershell
# 1. Install workspace dependencies
pnpm install

# 2. Create local environment files
Copy-Item .env.example .env
# Edit .env: set the TIDB_* values from your cluster, generate strong secrets. Never commit .env.
# DATABASE_URL = <cluster-prefix>.<app-user> + ?sslaccept=strict (runtime)
# DIRECT_URL   = <cluster-prefix>.root + ?sslaccept=strict (migrations only)
Copy-Item .env apps\api\.env -Force   # API + Prisma CLI read .env from apps/api

# 3. Start Redis (Compose runs Redis only; database is TiDB Cloud)
docker compose up -d

# 4. Generate Prisma client and apply the committed MySQL migration
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api exec prisma migrate deploy

# 5. Start API and web app
pnpm dev

# 6. Bootstrap the first Super Admin (after the API has been built once)
# The seed script reads process env, not .env automatically.
$env:DATABASE_URL = 'mysql://<cluster-prefix>.<app-user>:<app-password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/examnexus?sslaccept=strict'
$env:DIRECT_URL = 'mysql://<cluster-prefix>.root:<root-password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/examnexus?sslaccept=strict'
$env:ENCRYPTION_MASTER_KEY = '<same base64 32-byte key you put in .env>'
$env:SUPER_ADMIN_EMAIL = 'admin@example.com'
$env:SUPER_ADMIN_PASSWORD = 'a-long-unique-password'
$env:SUPER_ADMIN_PIN = 'a-long-unique-pin-value'
pnpm --filter @examnexus/api build
pnpm --filter @examnexus/api seed:super-admin
```

The seed command prints a TOTP secret, otpauth URI, current code and recovery codes once. Store them
offline; sign in at `/login`, complete MFA, then open `/admin/overview`.

For schema changes, `prisma migrate dev` cannot create its shadow database on this cluster. Generate
SQL with `prisma migrate diff` and apply it with `prisma migrate deploy`; see
[Section 6.1 of the setup guide](./setup-installation-guide.md). Tenant scoping is enforced in
application code (`PrismaService`) rather than by PostgreSQL RLS — see the
[TiDB Cloud tenant scoping ADR](../architecture/adr/0003-tidb-cloud-and-application-tenant-scoping.md).

URLs (default):

- Web SPA: http://localhost:5173
- API: http://localhost:3000/api/v1
- Swagger: http://localhost:3000/docs
- Health: http://localhost:3000/health/live and `/health/ready`

## Useful commands

```powershell
pnpm build                       # build all packages
pnpm test                        # run all unit tests
pnpm lint                        # lint + format check
pnpm --filter @examnexus/api prisma:studio
pnpm --filter @examnexus/web test       # Vitest unit tests

# Playwright is not configured yet; use the full setup guide for browser verification steps:
# docs/development/setup-installation-guide.md
```

## Without Docker

Run Redis natively or use a managed Redis endpoint, then set `DATABASE_URL`, `DIRECT_URL`
(migration-only root user), `REDIS_URL` and `STORAGE_LOCAL_PATH` in `.env`. TiDB Cloud is always
remote; keep `?sslaccept=strict` on both database URLs and do not use the cluster root user at
runtime. S3 variables are unused by the Phase 3 local storage adapter.

## Security note

The committed `.env.example` contains placeholders only. Generate real secrets with
`openssl rand -base64 48` (or your platform's KMS) and rotate them regularly.

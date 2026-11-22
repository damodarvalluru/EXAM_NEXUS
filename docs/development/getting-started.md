# Getting started

For the complete one-time installation and configuration walkthrough, see
[setup-installation-guide.md](./setup-installation-guide.md).

## Prerequisites

- Node.js ≥ 20.19 (Node 24 used during development)
- pnpm 12.3.4 (pinned by `packageManager`; enable it with Corepack)
- Docker Desktop with Compose v2 (or managed PostgreSQL 15+ and Redis 7+). Verification documents
  use local disk storage in Phases 2–3; an S3 adapter is planned later.

## Install and run

```powershell
# 1. Install workspace dependencies
pnpm install

# 2. Create local environment files
Copy-Item .env.example .env
# Edit .env: set strong local secrets. Never commit .env.
Copy-Item .env apps\api\.env -Force   # API + Prisma CLI read .env from apps/api

# 3. Start infrastructure (requires Docker; only Postgres + Redis by default)
docker compose up -d

# 4. Generate Prisma client and apply schema
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api exec prisma migrate deploy

# 5. Start API and web app (migration 0002 installs RLS policies automatically)
pnpm dev

# 6. Bootstrap the first Super Admin (after the API has been built once)
# The seed script reads process env, not .env automatically.
$env:DATABASE_URL = 'postgresql://examnexus:examnexus_dev@localhost:5432/examnexus?schema=public'
$env:DIRECT_URL = $env:DATABASE_URL
$env:ENCRYPTION_MASTER_KEY = '<same base64 32-byte key you put in .env>'
$env:SUPER_ADMIN_EMAIL = 'admin@example.com'
$env:SUPER_ADMIN_PASSWORD = 'a-long-unique-password'
$env:SUPER_ADMIN_PIN = 'a-long-unique-pin-value'
pnpm --filter @examnexus/api build
pnpm --filter @examnexus/api seed:super-admin
```

The seed command prints a TOTP secret, otpauth URI, current code and recovery codes once. Store them
offline; sign in at `/login`, complete MFA, then open `/admin/overview`.

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

Provision PostgreSQL and Redis yourself, then set `DATABASE_URL`, `DIRECT_URL` (for migrations),
`REDIS_URL` and `STORAGE_LOCAL_PATH` in `.env`. Do not disable RLS or use a superuser database role
for the API. S3 variables are unused by the Phase 3 local storage adapter.

## Security note

The committed `.env.example` contains placeholders only. Generate real secrets with
`openssl rand -base64 48` (or your platform's KMS) and rotate them regularly.

# Setup & Installation Guide (one-time)

This is the single reference for installing and configuring ExamNexus locally. It is based on the
actual `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, Prisma schema/migrations,
`.env.example` and runtime config in this repository. The database is a TiDB Cloud Serverless
cluster (MySQL-compatible); Docker Compose runs Redis only.

Commands below assume **Windows PowerShell** from the repository root, unless stated otherwise.

---

## 0. What is actually in the app

### Runtime dependencies (installed by `pnpm install`)

| Area | Technology | Version pinned here | Installed separately? |
|---|---|---:|---|
| Workspace | pnpm workspaces | `pnpm@12.3.4` | Yes — toolchain |
| Language | TypeScript | `5.9.3` | No — via pnpm |
| Backend | NestJS | `11.2.11` | No — via pnpm |
| Backend validation | `class-validator`, `class-transformer`, `zod` | `0.15.1`, `0.5.1`, `4.6.7` | No |
| Password/PIN hashing | `@node-rs/argon2` | `2.2.2` | No — prebuilt native binary via pnpm |
| ORM | Prisma + `@prisma/client` | `6.19.3` | No — then generate client |
| Database | TiDB Cloud Serverless (MySQL 8.0 protocol, TLS required) | Cluster `gateway01.us-east-1.prod.aws.tidbcloud.com:4000`, database `examnexus` | Yes — hosted credentials |
| Cache/session store | Redis + `ioredis` | `7-alpine`, `6.0.0` | Yes — Docker or native |
| HTTP cookies | `cookie-parser` | `1.4.7` | No |
| Security headers | `helmet` | `8.3.0` | No |
| JWT | `@nestjs/jwt` | `11.0.2` | No |
| API docs | `@nestjs/swagger` | `11.4.8` | No |
| Realtime | `socket.io`, Nest gateways | `4.8.4` | No |
| Frontend | React + React DOM | `19.3.1` | No |
| Frontend build | Vite + React plugin | `8.3.8`, `6.3.0` | No |
| Routing | React Router | `7.18.6` | No |
| Server state | TanStack Query | `5.108.2` | No |
| Tables | TanStack Table | `9.3.1` | No |
| Forms | React Hook Form + resolvers | `7.92.0`, `7.0.8` | No |
| Styling | Tailwind CSS + PostCSS + Autoprefixer | `3.4.19`, `8.5.33`, `10.7.0` | No |
| Animation | Framer Motion | `14.14.0` | No |
| Icons | lucide-react | `1.77.0` | No |
| Charts | ECharts | `6.1.0` | No |
| API tests | Jest + ts-jest + Supertest | `30.5.2`, `29.4.15`, `7.3.2` | No |
| UI tests | Vitest + jsdom + Testing Library | `5.1.1`, `31.0.1`, `16.3.3` | No |

### Infrastructure in `docker-compose.yml`

| Service | Required for Phases 2–3? | Notes |
|---|---|---|
| `redis` | **Yes** | Rate limits, refresh-token reuse tracking, email/invite/reset tokens, phone OTPs. |
| `minio` + `createbuckets` | No | Optional profile; S3-compatible object storage. Phase 3 uses **local disk**, not S3. |
| `mailhog` | No | Optional profile; SMTP catcher is present but no mail provider is wired in code yet. |

There is no database service in `docker-compose.yml`. Tenant data lives on TiDB Cloud, reached over
TLS with credentials from `.env` (see Section 4).

### Present but not required yet

- `bullmq@6.7.8` is installed, but there are no queue producers/workers wired yet. No worker install needed.
- Keycloak variables are placeholders; no OIDC/SAML integration is implemented in Phases 2–3.
- Playwright is **not** configured. The old `test:e2e` mention in `getting-started.md` was removed; use `pnpm test` for the existing Jest/Vitest suites.

---

## 1. Install the base toolchain

### 1.1 Node.js

The repo requires **Node >= 20.19.0**. Node 24 was used during development.

Using winget:

```powershell
winget install OpenJS.NodeJS.LTS
node -v
```

Expected: `v20.19.0` or newer.

If you use `nvm-windows` instead:

```powershell
nvm install 24
nvm use 24
node -v
```

### 1.2 pnpm

The repo pins pnpm through the `packageManager` field. Use Corepack:

```powershell
corepack enable
corepack prepare pnpm@12.3.4 --activate
pnpm -v
```

Expected: `12.3.4`.

If Corepack is unavailable in your environment:

```powershell
npm install -g pnpm@12.3.4
pnpm -v
```

Do **not** mix `npm install`, `yarn`, or `npx` dependency installs into this workspace. Use `pnpm` consistently.

### 1.3 Docker Desktop (recommended)

Docker is needed for local Redis; MinIO and MailHog are optional profiles. There is no local
PostgreSQL container. Install Docker Desktop with Compose v2:

```powershell
winget install Docker.DockerDesktop
docker --version
docker compose version
```

Enable WSL2 integration when prompted. Start Docker Desktop before continuing.

If you do not want Docker, run Redis natively or use a managed Redis endpoint (Section 5.2). The
TiDB Cloud database is hosted in all cases.

### 1.4 Git (optional)

The current folder is not a git repository, but Git is useful for version control:

```powershell
winget install Git.Git
git --version
```

---

## 2. Open the project

```powershell
cd D:\PROJECTS\MEGA_PROJECT\EXAMNEXUS
Get-ChildItem
```

You should see `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `apps\`, `packages\`, and `docs\`.

---

## 3. Install JavaScript/TypeScript dependencies

```powershell
pnpm install
pnpm --filter @examnexus/shared build
```

What this does:

- Installs all three workspace packages: `@examnexus/api`, `@examnexus/web`, `@examnexus/shared`.
- Downloads the `@node-rs/argon2` prebuilt native binary for your OS/Node ABI.
- Downloads Prisma engines. `pnpm-workspace.yaml` already allows the required build scripts for
  `@prisma/client`, `@prisma/engines`, and `prisma`.
- Builds the shared contracts package so API and web can import it.

If a corporate proxy blocks native/engine downloads, allow access to the npm registry and Prisma
engine CDN, then rerun `pnpm install`.

---

## 4. Configure environment variables

### 4.1 Generate the root `.env`

The API reads `.env` from the repository root (`ConfigModule.forRoot({ envFilePath: ['.env'] })`).

```powershell
$root = (Get-Location).Path

function New-B64([int]$Length) {
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [Convert]::ToBase64String($bytes)
}

$jwtAccess  = New-B64 48
$jwtRefresh = New-B64 48
$encKey     = New-B64 32
$storage    = (Join-Path $root 'apps/api/storage').Replace('\', '/')

New-Item -ItemType Directory -Force -Path (Join-Path $root 'apps/api/storage') | Out-Null

$envText = @"
NODE_ENV=development
API_PORT=3000
WEB_PORT=5173
API_PUBLIC_URL=http://localhost:3000
WEB_PUBLIC_URL=http://localhost:5173
DATABASE_URL=mysql://<cluster-prefix>.<app-user>:<app-password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/examnexus?sslaccept=strict
DIRECT_URL=mysql://<cluster-prefix>.root:<root-password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/examnexus?sslaccept=strict
TIDB_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
TIDB_PORT=4000
TIDB_DATABASE=examnexus
TIDB_APP_USER=<cluster-prefix>.<app-user>
TIDB_APP_PASSWORD=<app-password>
TIDB_USER=<cluster-prefix>.root
TIDB_PASSWORD=<root-password>
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=examnexus
S3_ACCESS_KEY_ID=examnexus_dev
S3_SECRET_ACCESS_KEY=examnexus_dev_secret
S3_FORCE_PATH_STYLE=true
STORAGE_LOCAL_PATH=$storage
JWT_ACCESS_SECRET=$jwtAccess
JWT_REFRESH_SECRET=$jwtRefresh
ENCRYPTION_MASTER_KEY=$encKey
COOKIE_DOMAIN=localhost
CORS_ORIGIN=http://localhost:5173
KEYCLOAK_URL=
KEYCLOAK_REALM=
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
"@

[System.IO.File]::WriteAllText((Join-Path $root '.env'), $envText, [System.Text.UTF8Encoding]::new($false))
```

Important notes:

- Replace the `<cluster-prefix>.<app-user>` / `<app-password>` and `<cluster-prefix>.root` /
  `<root-password>` placeholders with credentials supplied for this cluster. `.env.example` lists
  the same `TIDB_*` variables. Keep the root user out of the API's `DATABASE_URL`.
- Both database URLs must keep `?sslaccept=strict`: TLS is required on this cluster.
- `.env` is ignored by git. Never commit it.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must be at least 16 characters; 48-byte base64 is used above.
- `ENCRYPTION_MASTER_KEY` should be a base64-encoded 32-byte key, as generated above.
- `STORAGE_LOCAL_PATH` is set to an absolute path on purpose. If you leave it as `./storage`, it resolves relative to the API package working directory (`apps/api`) when started with `pnpm --filter`, and readiness checks can fail if that folder does not exist.
- `API_PUBLIC_URL`, `WEB_PORT`, `S3_*`, and Keycloak values are currently informational/unused. They are kept for forward compatibility.

### 4.1.1 Copy the env file into the API package

pnpm runs the API scripts with `apps/api` as the working directory. Both Nest `ConfigModule` and the
Prisma CLI therefore look for `.env` inside `apps/api`, not at the repository root.

```powershell
Copy-Item .env apps\api\.env -Force
```

Keep the two files in sync if you change local values. Both are gitignored.

### 4.2 Configure the frontend API origin

The web client reads `VITE_API_ORIGIN` in `apps/web/src/lib/api-client.ts`, **not** `API_PUBLIC_URL`.
Vite only exposes `VITE_*` variables and does not read the monorepo-root `.env`.

```powershell
Copy-Item apps\web\.env.example apps\web\.env.local -Force
Get-Content apps\web\.env.local
```

Expected:

```env
VITE_API_ORIGIN=http://localhost:3000
```

If you change this value, restart `pnpm dev` or rebuild the web app. Vite embeds it at build time.

### 4.3 Verify required variables are present

The API will refuse to start if any of these are missing or invalid:

- `DATABASE_URL` (least-privilege app user, `mysql://` + `?sslaccept=strict`)
- `DIRECT_URL` (cluster root user, migrations only)
- `REDIS_URL`
- `JWT_ACCESS_SECRET` (min 16 chars)
- `JWT_REFRESH_SECRET` (min 16 chars)
- `ENCRYPTION_MASTER_KEY` (min 16 chars)

Optional with defaults: `NODE_ENV`, `API_PORT`, `CORS_ORIGIN`, `COOKIE_DOMAIN`, `STORAGE_LOCAL_PATH`,
`INTEGRATION_OUTBOUND_ALLOWLIST` (empty = any public HTTPS host; pin this in production) and
`WEBHOOK_TOLERANCE_SECONDS` (default `300`). `TIDB_*` variables document the cluster connection;
`DATABASE_URL` and `DIRECT_URL` are the values actually consumed by Prisma.

---

## 5. Start infrastructure

### 5.1 Docker Compose path (recommended)

```powershell
docker compose up -d
docker compose ps
```

Only `examnexus-redis` starts by default; it is required for Phases 2–3. MinIO and MailHog are
behind the `optional` Compose profile and are not needed for the local storage adapter or current
auth flows. To start them anyway:

```powershell
docker compose --profile optional up -d
```

Check Redis readiness:

```powershell
docker compose logs --tail=30 redis
docker compose exec redis redis-cli ping
```

Expected Redis response: `PONG`.

If port `6379` is already in use, either stop the conflicting service or edit the port mapping in
`docker-compose.yml`. The optional profile adds `9000`, `9001`, `1025`, and `8025`. There is no
local port `5432` service: the database is hosted on TiDB Cloud.

### 5.2 Redis and TiDB Cloud without Docker

Run Redis natively (on Windows, commonly via WSL2 or Memurai) or point `REDIS_URL` at a managed Redis
instance:

```powershell
redis-server --appendonly yes
redis-cli ping
```

Expected: `PONG`.

TiDB Cloud is always remote. Verify TLS connectivity and credentials with Prisma after generating
the client (Section 6); a `P1001` error means the host, port, credentials or TLS settings in
`DATABASE_URL`/`DIRECT_URL` are wrong. Keep the least-privilege app user in `DATABASE_URL`; only
migrations use the cluster root user via `DIRECT_URL`.

---

## 6. Generate the Prisma client and apply migrations

```powershell
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api exec prisma migrate status
pnpm --filter @examnexus/api exec prisma migrate deploy
```

Migrations applied:

- `20261122000000_init` — the generated MySQL migration that creates the current schema. It replaces
  the PostgreSQL `0001_init` / `0002_rls` migrations, which are archived under
  `apps/api/prisma/legacy-postgres/` and must not be applied to TiDB Cloud.

Schema notes:

- `apps/api/prisma/schema.prisma` uses `provider = "mysql"` with `DATABASE_URL` for runtime and
  `DIRECT_URL` for migrations (`directUrl`).
- UUID values are `VARCHAR(36)`; the nine former PostgreSQL `String[]` columns are nullable `Json`
  columns.
- Tenant isolation is enforced in application code via `PrismaService` scoping, not by database RLS.
  There is no SQL policy-verification step.

### 6.1 Changing the schema (no shadow database)

`prisma migrate dev` cannot create its shadow database on this TiDB Cloud cluster. Generate the SQL
with `prisma migrate diff`, review it, commit it as a new migration, then apply it with
`prisma migrate deploy`. Paths below are relative to `apps/api` because `pnpm --filter` runs Prisma
from that package.

```powershell
# One-off baseline example: empty -> current schema.
$sql = pnpm --filter @examnexus/api exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
$target = 'prisma/migrations/<YYYYMMDDHHMMSS>_describe_your_change/migration.sql'
New-Item -ItemType Directory -Force -Path (Split-Path (Join-Path 'apps/api' $target)) | Out-Null
[System.IO.File]::WriteAllText((Join-Path 'apps/api' $target), ($sql -join "`n"), [System.Text.UTF8Encoding]::new($false))

pnpm --filter @examnexus/api exec prisma migrate deploy
pnpm --filter @examnexus/api prisma:generate
```

For an incremental change, keep a copy of the previously committed schema and diff
`--from-schema-datamodel <previous-schema> --to-schema-datamodel prisma/schema.prisma --script`
instead of `--from-empty`. Do not use `--from-migrations` / `--to-migrations`: those diff modes need
a shadow database. Write migration files as UTF-8 without a BOM, never edit an applied migration,
and never commit generated credentials.

---

## 7. Build the API and bootstrap the first Super Admin

Build first:

```powershell
pnpm --filter @examnexus/api build
```

The seed script does not load the root `.env` by itself, so export the required values into the
current PowerShell session. Use the same `ENCRYPTION_MASTER_KEY` value you generated in Section 4.1.

```powershell
$env:DATABASE_URL          = 'mysql://<cluster-prefix>.<app-user>:<app-password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/examnexus?sslaccept=strict'
$env:DIRECT_URL            = 'mysql://<cluster-prefix>.root:<root-password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/examnexus?sslaccept=strict'
$env:ENCRYPTION_MASTER_KEY = '<paste the 32-byte base64 key from .env>'
$env:SUPER_ADMIN_EMAIL     = 'admin@example.com'
$env:SUPER_ADMIN_PASSWORD  = 'a-long-unique-password-at-least-12-chars'
$env:SUPER_ADMIN_PIN       = 'a-long-unique-pin-at-least-12-chars'

pnpm --filter @examnexus/api seed:super-admin
```

Rules:

- Use the same values as `.env`: the seed writes through the least-privilege `DATABASE_URL` app user.
  `DIRECT_URL` is exported only because env validation requires it; the seed does not migrate.
- Password and PIN must each be at least 12 characters.
- The command prints a TOTP secret, `otpauth://` URI, current code, and 10 recovery codes **once**.
  Store them offline immediately.
- Re-running the seed for the same email resets that account's password hash, TOTP method, and
  recovery codes. Treat it as a rotation, not a harmless retry.

The API also seeds the canonical permission catalogue automatically on startup through
`PermissionSeedService`. No separate permission seed command is needed.

---

## 8. Run the app

```powershell
pnpm dev
```

This builds the shared package, then starts the API and web app in parallel.

Default URLs:

| URL | Purpose |
|---|---|
| `http://localhost:5173` | Web SPA |
| `http://localhost:3000/api/v1` | REST API |
| `http://localhost:3000/docs` | Swagger UI |
| `http://localhost:3000/health/live` | Liveness |
| `http://localhost:3000/health/ready` | Readiness: database + Redis + local storage |

Use `localhost` consistently. `COOKIE_DOMAIN=localhost` and `CORS_ORIGIN=http://localhost:5173`
will not match requests made from `127.0.0.1`.

To stop everything:

```powershell
# Stop the Node processes with Ctrl+C, then:
docker compose down
```

Add `-v` to also delete Docker volumes (`docker compose down -v`) only when you intentionally want a
fresh database.

---

## 9. End-to-end verification checklist

### 9.1 Infrastructure

```powershell
docker compose ps
docker compose exec redis redis-cli ping
```

Compose should list `examnexus-redis` (and only the optional services you enabled); the database is
verified by the API's `/health/ready` check below.

### 9.2 Health

```powershell
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

`ready` should return `"status":"ready"` with `database`, `redis`, and `storage` all `up`.

### 9.3 Static checks

```powershell
pnpm lint
pnpm test
pnpm build
```

Current expected results: API Jest suite passes, web Vitest suite passes, TypeScript builds pass.

The CI workflow (`.github/workflows/ci.yml`) runs install, shared build, Prisma client generation,
lint, tests and build on pushes and pull requests. Client generation uses placeholder `mysql://`
URLs with `?sslaccept=strict`; CI has no database service and does not run migrations. A green CI
run is not evidence of database connectivity or tenant isolation.

### 9.4 Browser journey

1. Open `http://localhost:5173/login`.
2. Sign in with the seeded Super Admin email and password.
3. Complete MFA using the seeded TOTP secret or current code.
4. Open `/admin/overview` and confirm real counts from the database.
5. Open `/profile` → security and verify sessions, MFA, and recovery-code screens.
6. Register an organisation at `/register`, including verification documents.
7. Review and approve it from `/admin/verification`.
8. Sign in as the organisation admin and open `/org/dashboard`.
9. Invite a tenant user from `/org/users` and verify role/permission screens.

If any screen shows fabricated numbers or succeeds with no backend call, treat it as a bug, not a
setup problem.

---

## 10. Everyday commands

```powershell
pnpm dev                                      # run API + web
pnpm build                                    # build all workspaces
pnpm test                                     # all unit tests
pnpm lint                                     # TypeScript checks
pnpm format                                   # Prettier write

pnpm --filter @examnexus/api dev              # API only
pnpm --filter @examnexus/web dev              # web only
pnpm --filter @examnexus/shared dev           # shared contracts watch

pnpm --filter @examnexus/api prisma:studio         # inspect DB (app user; use read-only care)
pnpm --filter @examnexus/api prisma:generate       # regenerate client
pnpm --filter @examnexus/api exec prisma migrate status   # check applied migrations
pnpm --filter @examnexus/api prisma:migrate:deploy # apply committed migrations
```

Do not run `prisma migrate dev` against the TiDB Cloud cluster (no shadow database). Use the
`prisma migrate diff` + `prisma migrate deploy` workflow in Section 6.1.

Vite's port is hardcoded to `5173` in `apps/web/vite.config.ts`. The `WEB_PORT` value in `.env` is
not currently read. To use another port:

```powershell
pnpm --filter @examnexus/web dev -- --port 5174
```

Then update `CORS_ORIGIN` to match.

---

## 11. Production deployment notes

When moving beyond local development:

1. Use the TiDB Cloud cluster over TLS and a managed Redis service (or hardened Redis with a
   persistent volume). There is no local database container to harden.
2. Run `pnpm --filter @examnexus/api prisma:migrate:deploy` as a release step with `DIRECT_URL`
   (cluster root user) scoped to the migration job only. Never use that credential in `DATABASE_URL`.
3. Generate fresh 48-byte JWT secrets and a fresh 32-byte encryption key in your secret manager.
4. Set `NODE_ENV=production`. The refresh cookie automatically becomes `Secure`.
5. Set `CORS_ORIGIN` and `COOKIE_DOMAIN` to real HTTPS hostnames.
6. Build the frontend with the production API origin:

   ```powershell
   $env:VITE_API_ORIGIN = 'https://api.your-domain.example'
   pnpm build
   ```

7. Keep `DATABASE_URL` on the least-privilege app user with `?sslaccept=strict`. Tenant isolation is
   enforced by application-level scoping (see the
   [TiDB Cloud ADR](../../architecture/adr/0003-tidb-cloud-and-application-tenant-scoping.md));
   review any raw SQL or non-Prisma access path that could bypass it.
8. Serve verification documents from a protected, backed-up local volume, or implement the planned
   S3 adapter before relying on object storage.

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment configuration: ...` | Missing/invalid required env var | Check `apps/api/.env` and root `.env`; restart API. |
| `Environment variable not found: DIRECT_URL` | API package `.env` missing | Run `Copy-Item .env apps\api\.env -Force`. |
| `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` for `prisma` | `prisma` treated as a pnpm script | Use `pnpm --filter @examnexus/api exec prisma ...`. |
| Prisma `P1001` | TiDB Cloud unreachable | Verify host/port `gateway01.us-east-1.prod.aws.tidbcloud.com:4000`, credentials and `?sslaccept=strict` in `DATABASE_URL`/`DIRECT_URL`. |
| TLS/handshake failure | Missing or strict TLS rejection | Keep `?sslaccept=strict` on both URLs; check the cluster's CA/TLS settings. |
| `prisma migrate dev` fails to create a shadow database | Unsupported on this cluster | Use `prisma migrate diff` + `prisma migrate deploy` (Section 6.1). |
| Prisma `P3019` or SQL syntax error at `﻿` | UTF-8 BOM in migration/lock file | Rewrite the affected file as UTF-8 without BOM. |
| Wrong data visible in queries | Non-Prisma path bypassed tenant scoping | Route access through the scoped data-access boundary; see the TiDB Cloud ADR. |
| Docker Desktop says "unable to start" | WSL2 not installed | Run `wsl --install --no-distribution` as Administrator, then restart. |
| `pull access denied for minio/mc` | Optional image/tag failure | Default Compose now starts only Redis; use `--profile optional` for MinIO. |
| Redis `ECONNREFUSED` | Redis not running | Start Redis; verify `REDIS_URL`. |
| `/health/ready` says storage `down` | Storage directory missing | Create the path in `STORAGE_LOCAL_PATH`. |
| CORS error in browser | Origin mismatch | Make `CORS_ORIGIN` exactly match the web URL. |
| Refresh cookie not sent | Using `127.0.0.1` with `COOKIE_DOMAIN=localhost`, or cross-site cookie blocked | Use `localhost` consistently or fix cookie/CORS settings. |
| Frontend calls wrong API | `VITE_API_ORIGIN` not set | Set it in `apps/web/.env.local`; restart/rebuild web. |
| `node -v` too old | Node below 20.19 | Upgrade Node; rerun `pnpm install`. |
| pnpm says build scripts ignored | Build approval issue | Check `pnpm-workspace.yaml` `allowBuilds`; rerun `pnpm install`. |
| Migration says already applied | Migration already recorded on the cluster | Use `prisma migrate status`; never hand-edit applied migrations. |
| Playwright command not found | Playwright not configured | Use `pnpm test`; E2E tooling is future work. |

---

## 13. One-time setup checklist

- [ ] Node >= 20.19 installed
- [ ] pnpm 12.3.4 active via Corepack
- [ ] TiDB Cloud app credentials and migration-only root credential available
- [ ] Docker Desktop running (Redis), or native/managed Redis available
- [ ] `pnpm install` completed
- [ ] Root `.env` created with generated secrets and `mysql://` URLs using `?sslaccept=strict`
- [ ] `apps/api/.env` copied from root `.env`
- [ ] `apps/web/.env.local` created with `VITE_API_ORIGIN`
- [ ] Local storage directory created
- [ ] `docker compose up -d` succeeded for Redis
- [ ] Prisma client generated
- [ ] All committed migrations applied via `prisma migrate deploy`
- [ ] `prisma migrate status` reports no pending migrations
- [ ] API built
- [ ] Super Admin seeded; TOTP and recovery codes stored offline
- [ ] `pnpm dev` running
- [ ] `/health/live` and `/health/ready` green
- [ ] `pnpm lint`, `pnpm test`, `pnpm build` green
- [ ] Browser journeys verified with real backend data

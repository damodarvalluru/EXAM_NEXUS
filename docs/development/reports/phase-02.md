# Phase 2 report — Super Admin authentication and platform security

**Date:** 2026-11-21  
**Status:** Code complete and verified by build, lint and unit tests. Database/Redis-dependent flows
were not executed locally because Docker/Postgres/Redis are unavailable in this environment.

## Final integrated status addendum (2026-11-25)

Later verification added live TiDB Cloud/Redis coverage, browser E2E login and role-journey tests,
and the integrated final checks described in
[`evidence/phase-08/final-verification.md`](../../../evidence/phase-08/final-verification.md). The
historical availability note below is preserved for context but superseded by that evidence. Real
third-party outbound calls remain outside local verification.

## TiDB Cloud migration note (2026-11-22)

The sections below are the historical Phase 2 record as written on 2026-11-21. On 2026-11-22 the
database moved from local PostgreSQL to TiDB Cloud Serverless (MySQL-compatible, TLS required).
Statements about live RLS verification now refer to application-level tenant scoping in
`PrismaService` (implementation being finalised separately), not PostgreSQL policies. Runtime uses a
least-privilege app user in `DATABASE_URL`; the cluster root user is reserved for migrations via
`DIRECT_URL`. Commands using `docker compose` for Postgres or `prisma migrate dev` are stale; see the
current [getting-started guide](../getting-started.md).

## Final integration verification (2026-11-22)

This section supersedes the pending runtime statements in the historical record above.

- Auth lockout, MFA and step-up fixes were verified in the final integration pass; targeted auth
  tests passed **10/10**.
- Redis counters are available at runtime (`docker exec examnexus-redis redis-cli ping` → `PONG`),
  so Redis-backed rate limits and token replay tracking no longer depend on missing infrastructure.
  Docker stopped again during the final worker run and was restarted, with the ping re-verified.
- Redis failure-counter clearing on reactivation/unlock is implemented in
  `RateLimitService.clearUserFailures()` and wired into admin user reactivation/PIN rotation,
  organisation member reactivation/review/invitation acceptance and auth auto-unlock after lockout
  expiry; it is best-effort when Redis is unavailable. Runtime check: seeded
  `failures:login:1.2.3.4:user-1`, `failures:pin:5.6.7.8:user-1` and `failures:mfa:user-1`, called
  `clearUserFailures({ userId: 'user-1', email: 'user-1@example.com' })`, logged "Cleared 3 failure
  counter(s) for user user-1"; `MGET` returned `[null,null,null]`. Combined fix tests passed
  (5 suites / 50 tests, covering rate-limit, admin, organisations and auth security).
- Final checks passed: `pnpm lint`, `pnpm test` (API 14 suites passed / 2 skipped, 93 tests passed /
  10 skipped; web 2 tests passed), `pnpm build` and
  `pnpm --filter @examnexus/api exec prisma validate`. Live DB suite with Redis running:
  `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand` → 16 suites, 103 tests passed.
  Applied migrations: `20261122000000_init`, `20261122120000_admin_integration_support`,
  `20261122130000_exam_integrity`; `prisma migrate status` → "Database schema is up to date!".
- The API boots successfully (after importing `CommonModule` into `ExaminationsModule` so
  `AuditService` resolves); `/health/ready` returns 200 with database up (609 ms), redis up (1 ms)
  and storage up, and `/api/v1/modules` lists phases 1–6 implemented.
- Residual/not claimed: browser E2E login/MFA/PIN journeys, real external-provider calls, production
  alerting/on-call/SLA, paid-billing provider actions and Phases 7–8. No production security
  assurance is implied by these checks.

## Features completed

- Password and strong PIN login for Super Admins and all account types. PIN authentication requires
  an enrolled TOTP factor and is intentionally unavailable as a single-factor shortcut.
- RFC 6238 TOTP enrollment/confirmation, one-time recovery codes generated with 256-bit randomness,
  TOTP regenerated recovery codes and phone OTP challenge support.
- Rotating opaque refresh tokens in HttpOnly/Secure/SameSite cookies scoped to `/api/v1/auth`;
  reuse of a rotated token revokes the whole session family.
- Access tokens held only in browser memory (15 minutes), with single-flight refresh and 401 retry.
- Auth events for every login/MFA/PIN outcome, rate limits backed by Redis, account lockout after
  repeated failures, and session revocation on status change/password change.
- Global permission catalogue seeded at startup and tenant default roles seeded from
  `TENANT_ROLE_PERMISSIONS`.
- Global auth/RBAC/step-up guards with `@Public()`, `@RequirePermissions()`, `@TenantScoped()` and
  `@RequireStepUp()` decorators.
- Super Admin overview, user management, role/permission browsing, auth event search, audit log
  search and step-up-protected PIN rotation API.
- Frontend: real login/PIN/MFA forms, account-link pages, protected routes, AuthProvider,
  Super Admin overview/users/roles/log screens and profile/security screen with sessions, MFA and
  step-up workflows.

## Features pending

- WebAuthn, SSO/OIDC/SAML and risk-based CAPTCHA (deferred by specification).
- Live RLS, cross-tenant isolation, penetration and load tests (require infrastructure).
- Browser E2E tests for complete login/MFA/PIN flows against a running stack.

## Files and modules created or changed

```
apps/api/src/common/{crypto/{crypto.service,totp.service},services/{audit,auth-event,rate-limit,permission-seed},guards/{jwt-auth,permissions,step-up,tenant},decorators/*}
apps/api/src/modules/auth/{auth.service,auth.controller,auth.module,token.service,principal.service,session.service,dto/auth.dto}
apps/api/src/modules/admin/{admin.service,admin.controller,admin.module,dto/admin.dto}
apps/api/src/modules/organisations/{organisations.service,organisations.controller,dto/organisation.dto}
apps/api/src/scripts/seed-super-admin.ts
apps/api/src/app.module.ts, apps/api/src/app.controller.ts, apps/api/src/health/health.controller.ts
apps/api/src/modules/modules.controller.ts, apps/api/package.json
packages/shared/src/{permissions,auth,admin,enums,organisations,index}.ts
apps/web/src/{App.tsx,app/AppShell.tsx,components/auth/*,features/auth/*,features/admin/*,features/profile/*,lib/api-client.ts,config/navigation.ts,styles/index.css,App.test.tsx}
docs/{api/index.md,security/security-overview.md,development/{roadmap,getting-started,reports/phase-02.md}}
```

## Database changes

No new tables were required; Phase 1 schema already includes users, sessions, MFA methods, recovery
codes, auth events, audit logs, permissions, roles and super-admin credentials. Permission rows are
seeded idempotently at API startup. Verification documents are written to `STORAGE_LOCAL_PATH` and
tracked in `file_objects`; the S3 adapter remains future work.

## APIs implemented

See [`docs/api/index.md`](../../api/index.md) for the full route/permission matrix. Phase 2 adds all
`/auth` and `/admin` routes plus global guard wiring.

## Tests executed and results

| Check | Result |
| --- | --- |
| `pnpm --filter @examnexus/shared build` | Passed |
| `pnpm --filter @examnexus/api lint` | Passed (strict TypeScript, no errors) |
| `pnpm --filter @examnexus/web lint` | Passed |
| `pnpm --filter @examnexus/api test` | Passed — 3 API unit tests |
| `pnpm --filter @examnexus/web test` | Passed — 2 SPA tests |
| `pnpm --filter @examnexus/shared test` | Passed (no-op shared package check) |
| `pnpm build` | Passed — shared, API and SPA built |

No integration tests, database migrations, RLS checks, browser E2E tests, penetration tests or load
tests were executed. Do not interpret the results above as security assurance.

## Security issues identified

1. RLS policies are still unverified against a live PostgreSQL instance.
2. TOTP secrets are encrypted with `ENCRYPTION_MASTER_KEY`; production must provide a real 32-byte
   base64 key from a KMS/Vault. The development fallback is deterministic and not production-safe.
3. Refresh-cookie origin checks only activate when `NODE_ENV=production`.
4. Dev endpoints return verification, invitation and reset tokens in responses. Confirm they are
   disabled in production before deployment.
5. Password/PIN policies are enforced by DTO minimum length (12) but no external password breached
   list or CAPTCHA provider is integrated.
6. Argon2id uses OWASP-recommended parameters and is provided by `@node-rs/argon2`; no independent
   cryptographic review was performed.

## Instructions to run

```powershell
Copy-Item .env.example .env
# Set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_MASTER_KEY, DATABASE_URL, REDIS_URL
docker compose up -d
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api prisma:migrate:dev
pnpm build
pnpm dev
```

Then bootstrap the first Super Admin (after migrations and with the same `ENCRYPTION_MASTER_KEY`):

```powershell
$env:SUPER_ADMIN_EMAIL = 'admin@example.com'
$env:SUPER_ADMIN_PASSWORD = 'a-long-unique-password'
$env:SUPER_ADMIN_PIN = 'a-long-unique-pin-value'
pnpm --filter @examnexus/api build
pnpm --filter @examnexus/api seed:super-admin
```

The script prints the TOTP secret, otpauth URI, current code and recovery codes once. Store them
offline before signing in at `http://localhost:5173/login`.

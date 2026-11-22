# Phase 2 report — Super Admin authentication and platform security

**Date:** 2026-11-21  
**Status:** Code complete and verified by build, lint and unit tests. Database/Redis-dependent flows
were not executed locally because Docker/Postgres/Redis are unavailable in this environment.

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

# Phase 3 report — Organisation onboarding and tenancy

**Date:** 2026-11-21  
**Status:** Code complete and verified by build, lint and unit tests. Database/Redis/storage-dependent
flows were not executed locally because Docker/Postgres/Redis are unavailable in this environment.

## TiDB Cloud migration note (2026-11-22)

The sections below are the historical Phase 3 record as written on 2026-11-21. On 2026-11-22 the
database moved from local PostgreSQL to TiDB Cloud Serverless (MySQL-compatible, TLS required).
Claims that PostgreSQL RLS policies were the database-level enforcement layer are no longer true:
tenant isolation is now application-level scoping in `PrismaService` (implementation being finalised
separately), with the old RLS SQL archived under `apps/api/prisma/legacy-postgres/`. Database-backed
and cross-tenant isolation tests against the new cluster remain pending; see the current
[getting-started guide](../getting-started.md) and
[setup guide](../setup-installation-guide.md).

**2026-11-22 Phase 4 verification update:** live tenant-isolation tests against the TiDB Cloud
cluster now pass (4/4 with `RUN_DB_TESTS=1`), and the compound-unique ownership check bug they
exposed in `tenant-scope.ts` was fixed. Redis-dependent and browser E2E flows remain unverified.

## Final integration verification (2026-11-22)

This section supersedes the pending live-database statements in the historical record above.

- `/organisations/me/profile` returns the `OrganisationView`; `GET /organisations/me` remains a
  backwards-compatible dashboard alias and `PATCH /organisations/me` is the profile update route.
  Duplicate-email registration now returns 409, membership checks are enforced, and a document-type
  whitelist plus path-traversal fix were verified.
- Legacy slash-form verification document keys are now supported through a narrow whitelist
  (`REGISTRATION`, `ID_PROOF`, `ADDRESS_PROOF`, `ADDITIONAL`, `verification`) mapping `<prefix>/<uuid>`
  to the historical `<prefix>_<uuid>` on-disk name. Unknown prefixes, traversal, absolute/drive/UNC
  paths, null bytes, backslashes and nested keys are still rejected; **21 focused org-document
  tests pass**.
- Targeted organisation tenant-scope tests passed **9/9**; the full opt-in live DB suite with Redis
  running passed 16 suites / 103 tests
  (`RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand`). Redis is up
  (`docker exec examnexus-redis redis-cli ping` → `PONG`); Docker was restarted again after it
  stopped during the final worker run. Combined fix tests passed (5 suites / 50 tests, covering
  rate-limit, admin, organisations and auth security).
- Final checks passed: `pnpm lint`, `pnpm test` (API 14 suites passed / 2 skipped, 93 tests passed /
  10 skipped; web 2 tests passed), `pnpm build` and
  `pnpm --filter @examnexus/api exec prisma validate`. Applied migrations:
  `20261122000000_init`, `20261122120000_admin_integration_support`,
  `20261122130000_exam_integrity`; `prisma migrate status` → "Database schema is up to date!".
- The API boots successfully and `/health/ready` returns 200 with database up (609 ms), redis up
  (1 ms) and storage up; `/api/v1/modules` lists phases 1–6 implemented.
- Residual/not claimed: browser E2E flows, S3 object-storage adapter, real third-party outbound
  calls, production alerting/on-call/SLA and paid-billing provider actions. Legacy slash-form
  document key compatibility is closed as described above.

## Features completed

- Public organisation registration with administrator creation, slug/email/duplicate checks,
  default tenant roles, trial subscription, primary membership, verification record and audit event.
- Verification documents accepted during registration (base64, max five files of 10 MB each) and
  through the tenant profile screen; files are written under `STORAGE_LOCAL_PATH` and tracked in
  `file_objects`.
- Platform verification workflow with approve, reject, request-info, suspend and reactivate
  decisions, each recorded in the audit trail.
- Platform organisation list/detail screens with verification history, counts and document download.
- Tenant dashboard computed from live tenant-scoped counts and recent examinations.
- Tenant profile/branding updates, user invitations, member status changes, role assignment,
  tenant role creation/deletion with real permission catalogue, and candidate management.
- Tenant isolation is enforced in backend code through `PrismaService.withTenant()` for all
  tenant-scoped writes/reads and `withElevated()` only for platform/administrator operations;
  PostgreSQL RLS policies from Phase 1 remain the database-level enforcement layer.
- Frontend: organisation registration form, verification queue, tenant dashboard/profile/users/
  roles/candidates screens, all using live API data with loading, error and empty states.

## Features pending

- S3-compatible object-storage adapter for verification documents (local disk adapter implemented).
- Email/SMS delivery providers; development tokens are returned directly outside production.
- Subscription/billing screens and automated verification document checks (Phase 6+).
- Live cross-tenant isolation tests and RLS verification against PostgreSQL.

## Files and modules created or changed

```
apps/api/src/modules/organisations/{organisations.service,organisations.controller,dto/organisation.dto}
apps/api/src/config/configuration.ts, apps/api/src/config/env.validation.ts
apps/api/src/app.module.ts, apps/api/package.json
packages/shared/src/{organisations,permissions,admin,enums,index}.ts
apps/web/src/features/organisations/{OrganisationRegistrationPage,TenantPages}.tsx
apps/web/src/features/admin/{AdminOrganisationsPage,AdminRolesPage}.tsx
apps/web/src/{App.tsx,app/AppShell.tsx,config/navigation.ts,components/ui/DataState.tsx,styles/index.css}
.env.example, docs/api/index.md, docs/development/{roadmap,getting-started,reports/phase-03.md}
```

## Database changes

No new tables; tenant data uses the Phase 1 schema and RLS policies. Registration writes to
`organisations`, `users`, `user_profiles`, `organisation_memberships`, `organisation_verifications`,
`subscriptions`, `roles`, `role_permissions`, `user_roles`, `notifications` and `file_objects`.
Document bytes are stored on local disk, with metadata in `file_objects`.

## APIs implemented

See [`docs/api/index.md`](../../api/index.md) for all `/organisations` routes and permissions.
Platform review routes require `platform.verification.review` or `platform.organisations.manage`;
tenant routes require both a verified tenant context and the relevant `org.*` permission.

## Tests executed and results

| Check | Result |
| --- | --- |
| `pnpm --filter @examnexus/shared build` | Passed |
| `pnpm --filter @examnexus/api lint` | Passed |
| `pnpm --filter @examnexus/web lint` | Passed |
| `pnpm --filter @examnexus/api test` | Passed — 3 API unit tests |
| `pnpm --filter @examnexus/web test` | Passed — 2 SPA tests |
| `pnpm build` | Passed |

No live registration, document-upload, approval or cross-tenant access test was executed because
Postgres/Redis are unavailable. The local document adapter and RLS policies are therefore unverified
at runtime.

## Security issues identified

1. RLS policies were not exercised against a live database; this is the highest-priority verification
   task before deployment.
2. Local verification documents are served through the API; object keys are random UUIDs under a
   document-type prefix, but production should move to S3 with private buckets and signed URLs.
3. Registration accepts base64 documents directly; request body size must be bounded at the reverse
   proxy in production (DTO caps decoded content at 10 MB per file).
4. Email verification tokens are returned in non-production responses for local testing.
5. Organisation approval is a manual platform action; no automated legal/identity verification is
   claimed.

## Instructions to run

Follow [`docs/development/getting-started.md`](../getting-started.md), then:

1. Register an organisation at `http://localhost:5173/register` (or `POST /api/v1/organisations/register`).
2. Verify the administrator email using the development token with `/verify-email?token=...`.
3. Sign in as a Super Admin, open `/admin/verification`, review the submission and approve it.
4. The organisation administrator can then sign in and use `/org/dashboard`.

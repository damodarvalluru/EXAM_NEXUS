# Development roadmap and phase status

Status legend: ✅ complete · 🚧 in progress · ⬜ pending

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Architecture, project setup, database, frontend/backend skeletons, API gateway, infrastructure | ✅¹ |
| 2 | Super Admin auth (password + PIN), MFA, RBAC, audit logging | ✅² |
| 3 | Organisation registration, verification, approval, dashboards, user management | ✅² |
| 4 | Question bank, examination engine, scheduling, candidate portal, delivery | ✅⁴ |
| 5 | Integrations, API gateway policies, OAuth/webhooks, synchronisation | ✅⁵ |
| 6 | Complete Super Admin dashboard, analytics, monitoring, security centre | ✅⁶ |
| 7 | AI evaluation, proctoring, advanced reporting, certificates | ⬜ |
| 8 | Load testing, penetration testing, disaster recovery, independent review | ⬜ |

## Phase 1 checklist

- [x] Requirements analysis and system architecture
- [x] Architecture decision records
- [x] Monorepo structure (pnpm workspaces)
- [x] Full relational schema with tenant keys; the original RLS SQL is now archived as legacy
- [x] Running local Redis via Docker Compose — verified on 2026-11-22 (`redis-cli ping` → PONG);
      the database is TiDB Cloud (no local DB container)
- [x] NestJS API skeleton with versioning, Swagger, validation, health checks
- [x] React SPA skeleton with design tokens, routing, API client
- [x] CI workflow and pinned dependencies
- [x] Dependency install + build + test verification

## Phase 2 checklist

- [x] Argon2id password/PIN hashing and RFC 6238 TOTP
- [x] Access/refresh/session/MFA/step-up token lifecycle
- [x] Redis-backed rate limits and token replay tracking
- [x] Redis failure-counter clearing on reactivation/unlock (`RateLimitService.clearUserFailures()`)
- [x] Global auth, tenant, permission and step-up guards
- [x] Super Admin overview, users, roles, auth logs and audit logs
- [x] Frontend login, PIN, MFA, profile/security and protected routes
- [x] API docs, setup instructions and phase report
- [x] Live tenant-scoping/integration verification with TiDB Cloud and Redis (16 suites / 103 tests)
- [ ] Browser E2E verification

## Phase 3 checklist

- [x] Public organisation registration with administrator and documents
- [x] Verification review workflow and document download
- [x] Legacy slash-form document key compatibility (narrow whitelist, 21 focused tests)
- [x] Live tenant dashboard, profile, users, roles and candidates screens
- [x] Tenant-scoped service calls with backend permission enforcement
- [x] API docs, setup instructions and phase report
- [x] Live cross-tenant isolation tests (9/9 tenant-scope tests on 2026-11-22)
- [ ] S3 document adapter

## Phase 4 checklist

- [x] Tenant-isolated question banks, questions, options and objective validation
- [x] Draft authoring, immutable published snapshots with SHA-256 hashes and scheduling/status controls
- [x] Candidate eligibility windows and candidate portal account provisioning
- [x] Server-authoritative attempts, autosave, expiry, idempotent submissions and grading
- [x] Candidate workspace, organisation examination/bank screens, live monitoring and evaluation queue
- [x] Authenticated attempt-scoped realtime channel
- [x] API docs, unit tests and opt-in live candidate-to-result database flow
- [ ] Browser E2E automation, proctoring and manual subjective evaluation (Phase 7/later)

¹ Phase 1 code/configuration is complete and verified by build, lint and unit tests. As of
2026-11-22 the MySQL migrations are applied to the TiDB Cloud cluster (see migration note below),
Redis is running locally (`redis-cli ping` → PONG), the API boots and the full opt-in live suite
passes (16 suites / 103 tests). Browser E2E and the residual items in the footnotes below remain
unverified; see the [Phase 1 report](reports/phase-01.md).

² Phases 2 and 3 are code-complete; final `pnpm lint`, `pnpm test` and `pnpm build` pass. Live TiDB
Cloud tenant scoping was extended on 2026-11-22 to the full opt-in suite (16 suites / 103 tests with
Redis running); targeted auth tests passed 10/10 and organisation tenant-scope tests 9/9. Redis
failure-counter clearing on reactivation/unlock and legacy slash-form document key compatibility are
implemented and runtime-verified (combined fix tests: 5 suites / 50 tests). Browser E2E and real
external-provider journeys remain unexecuted. See the [Phase 2](reports/phase-02.md) and
[Phase 3](reports/phase-03.md) reports.

## Phase 5 checklist

- [x] Tenant integration records, encrypted credential vault, scoped permissions and lifecycle states
- [x] SSRF-safe HTTPS connection tests and candidate synchronisation with dry-run support
- [x] Signed webhook endpoints, secret rotation, retry queue and Redis nonce replay protection
- [x] API clients, hashed API keys, scope enforcement and candidate ingest endpoint
- [x] Cross-tenant integration monitoring, frontend screens, API docs and phase report
- [ ] Live outbound calls to a real third-party provider (no external credentials available locally)
- [ ] Redis nonce replay and webhook retry journeys — Redis is running locally as of 2026-11-22, but
      those specific journeys are not separately claimed as verified

## Phase 6 checklist

- [x] Expanded platform overview with candidates, API, security and examination-type metrics
- [x] Analytics with date-ranged series, CSV export and security centre alert/incident updates
- [x] Live health checks, queue/storage totals, notifications, subscriptions and support tickets
- [x] Platform settings and cross-tenant live attempt monitoring
- [x] Frontend routes, navigation and permission gates for every new module; phase report
- [ ] Browser E2E automation and production alerting/escalation policies

⁴ Phase 4 passes build, lint, unit tests and opt-in live database verification. The earlier
20/20 candidate-to-result run was superseded on 2026-11-22 by the full live suite (16 suites / 103
tests with `RUN_DB_TESTS=1` and Redis running); targeted exam grading tests passed 10/10. Frozen
published snapshots, attempt `versionId` binding, stored submission receipts and a unique answer
index are applied by `20261122130000_exam_integrity`. Browser E2E, proctoring and manual subjective
evaluation remain out of scope. See the [Phase 4 report](reports/phase-04.md).

⁵ Phase 5 is code-complete; final `pnpm lint`, `pnpm test` and `pnpm build` pass and the full live
suite passed 16 suites / 103 tests with Redis running (targeted integration tests 21/21). Routes are
mounted once under `/api/v1/integrations`, including the public inbound webhook. Live outbound calls
to a real third-party provider remain unexecuted (no credentials), and browser E2E remains
unexecuted; see the [Phase 5 report](reports/phase-05.md).

⁶ Phase 6 is code-complete; final lint/test/build pass and the full live suite passed 16 suites /
103 tests with Redis running (targeted admin tests 14/14). CSV export, analytics, health and
administration screens read real database records, including `ApiRequestLog` metrics and pass rates
from `examination.passingMarks`; health reports structured DOWN/DEGRADED states. Production alerting,
escalation/on-call/SLA policies, paid-billing provider mutations and browser E2E remain unexecuted;
see the [Phase 6 report](reports/phase-06.md).

## TiDB Cloud migration note (2026-11-22)

The database is now a TiDB Cloud Serverless cluster (MySQL-compatible, TLS required) instead of
local PostgreSQL. The shared schema remains, but PostgreSQL RLS was replaced by application-level
tenant scoping in `PrismaService`; the old RLS SQL is archived under
`apps/api/prisma/legacy-postgres/`. The nine former `String[]` columns are nullable `Json`, UUIDs
are `VARCHAR(36)`, and the applied migrations are `20261122000000_init`, the additive
`20261122120000_admin_integration_support` and `20261122130000_exam_integrity`.
`prisma migrate status` reports "Database schema is up to date!". The last migration adds frozen
published-snapshot `contentHash`, attempt `versionId` binding, a stored submission receipt and a
unique answer index; it was made conditional because an earlier failed attempt had already added
`contentHash`. `prisma migrate dev` cannot create a shadow database here: generate SQL with
`prisma migrate diff` and apply with
`prisma migrate deploy` (see the [setup guide](setup-installation-guide.md#6-generate-the-prisma-client-and-apply-migrations)).
CI runs install, Prisma client generation with placeholder `mysql://` URLs, lint, tests and build;
it has no database service and does not run migrations. The linked historical phase reports keep
their original wording and carry their own dated migration notes.

See [ADR-0002 (superseded)](../architecture/adr/0002-shared-schema-rls.md) and the
[TiDB Cloud tenant scoping ADR](../architecture/adr/0003-tidb-cloud-and-application-tenant-scoping.md).

## Phase reports

Reports are written to `docs/development/reports/` at the end of each phase using the required
format: features completed, pending, files/modules, database changes, APIs, tests/results,
security issues, run instructions.

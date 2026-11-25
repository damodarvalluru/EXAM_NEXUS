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
| 7 | AI evaluation, proctoring, advanced reporting, certificates | ✅⁷ |
| 8 | Load testing, penetration testing, disaster recovery, independent review | 🚧⁸ (internal work complete; two external sign-offs pending) |

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
- [x] Browser E2E verification (11 Chromium tests cover the full project after integration)

## Phase 3 checklist

- [x] Public organisation registration with administrator and documents
- [x] Verification review workflow and document download
- [x] Legacy slash-form document key compatibility (narrow whitelist, 21 focused tests)
- [x] Live tenant dashboard, profile, users, roles and candidates screens
- [x] Tenant-scoped service calls with backend permission enforcement
- [x] API docs, setup instructions and phase report
- [x] Live cross-tenant isolation tests (9/9 tenant-scope tests on 2026-11-22)
- [x] S3-compatible document storage adapter (Node `fetch` + AWS Signature V4; no AWS SDK dependency)

## Phase 4 checklist

- [x] Tenant-isolated question banks, questions, options and objective validation
- [x] Draft authoring, immutable published snapshots with SHA-256 hashes and scheduling/status controls
- [x] Candidate eligibility windows and candidate portal account provisioning
- [x] Server-authoritative attempts, autosave, expiry, idempotent submissions and grading
- [x] Candidate workspace, organisation examination/bank screens, live monitoring and evaluation queue
- [x] Authenticated attempt-scoped realtime channel
- [x] API docs, unit tests and opt-in live candidate-to-result database flow
- [x] Browser E2E automation, including candidate start/autosave/submit and role-based portal journeys
      (Phase 7 proctoring/manual evaluation tests are listed below)

¹ Phase 1 code/configuration is complete and verified by build, lint, unit tests and browser E2E.
The MySQL migrations are applied to the TiDB Cloud cluster (see migration note below), the API boots
and the full opt-in live suite passed 16 suites / 103 tests on 2026-11-22. Trivy now completes with
zero findings after dependency overrides. See the [Phase 1 report](reports/phase-01.md) and the
[integrated final verification](../../evidence/phase-08/final-verification.md).

² Phases 2 and 3 are code-complete; `pnpm lint`, `pnpm test`, `pnpm build` and browser E2E pass.
Live TiDB Cloud tenant scoping was verified on 2026-11-22 (16 suites / 103 tests with Redis
running); targeted auth tests passed 10/10 and organisation tenant-scope tests 9/9. Redis
failure-counter clearing, legacy slash-form document key compatibility, and the S3-compatible
storage adapter are implemented and tested. Real external-provider journeys remain unexecuted. See
the [Phase 2](reports/phase-02.md) and [Phase 3](reports/phase-03.md) reports.

## Phase 5 checklist

- [x] Tenant integration records, encrypted credential vault, scoped permissions and lifecycle states
- [x] SSRF-safe HTTPS connection tests and candidate synchronisation with dry-run support
- [x] Signed webhook endpoints, secret rotation, retry queue and Redis nonce replay protection
- [x] API clients, hashed API keys, scope enforcement and candidate ingest endpoint
- [x] Cross-tenant integration monitoring, frontend screens, API docs and phase report
- [x] OAuth2/OIDC authorization-code flow with PKCE `S256`, single-use Redis state and token exchange
- [x] Redis nonce replay and signed webhook retry journeys, implemented with opt-in live integration
      tests (`RUN_DB_TESTS=1`) and deterministic unit coverage
- [ ] Live outbound calls to a real third-party provider (no external credentials available locally)

## Phase 6 checklist

- [x] Expanded platform overview with candidates, API, security and examination-type metrics
- [x] Analytics with date-ranged series, CSV export and security centre alert/incident updates
- [x] Live health checks, queue/storage totals, notifications, subscriptions and support tickets
- [x] Platform settings and cross-tenant live attempt monitoring
- [x] Frontend routes, navigation and permission gates for every new module; phase report
- [x] Browser E2E automation, production alerting/escalation/SLA, notification dispatch, billing
      checkout/cancel/restore and production nonce-based CSP

⁴ Phase 4 passes build, lint, unit tests, browser E2E and opt-in live database verification. The
earlier 20/20 candidate-to-result run was superseded on 2026-11-22 by the full live suite (16 suites
/ 103 tests with `RUN_DB_TESTS=1` and Redis running); targeted exam grading tests passed 10/10.
Frozen published snapshots, attempt `versionId` binding, stored submission receipts and a unique
answer index are applied by `20261122130000_exam_integrity`. Proctoring and manual subjective
evaluation are covered in Phase 7. See the [Phase 4 report](reports/phase-04.md).

⁵ Phase 5 is code-complete; `pnpm lint`, `pnpm test`, `pnpm build` and browser E2E pass, and the full
live suite passed 16 suites / 103 tests with Redis running (targeted integration tests 21/21).
Routes are mounted once under `/api/v1/integrations`, including the public inbound webhook.
Authorization-code OAuth with PKCE, CSV mapping/import, guarded lifecycle actions, signed webhook
retry and Redis nonce replay coverage are implemented. Live outbound calls to a real third-party
provider remain unexecuted (no credentials); see the [Phase 5 report](reports/phase-05.md).

⁶ Phase 6 is code-complete; `pnpm lint`, `pnpm test`, `pnpm build` and browser E2E pass, and the
full live suite passed 16 suites / 103 tests with Redis running (targeted admin tests 14/14). CSV
export, analytics, health and administration screens read real database records; health reports
structured DOWN/DEGRADED states. Production alerting with escalation/SLA dispatch, notification
delivery, billing provider mutations with signed webhooks, and production nonce-based CSP are now
implemented and covered by tests. See the [Phase 6 report](reports/phase-06.md).

## Phase 7 checklist

- [x] Deterministic, explainable AI mark suggestions that never apply marks themselves
- [x] Human evaluation queue, blind review, revision and result versioning
- [x] Publication gate: objective-only auto-publish; subjective results require completed review
- [x] Candidate-visible results only when `PUBLISHED`
- [x] Advisory proctoring events, explainable risk scoring and human review/appeal workflow
- [x] Tenant analytics and CSV export from persisted records
- [x] Certificates from published passing results, public verification, PDF and revocation
- [x] Frontend routes/navigation and API documentation
- [x] Current-evaluation freshness, immutable marks history and server-issued short-lived proctor tokens
- [x] Read-only rank query, explicit rank persistence, CSV formula-injection protection and corrected
      certificate verification links/statuses
- [x] Unit tests, live Phase 7 service flow, lint/test/build and browser E2E verification

⁷ Phase 7 is code-complete and locally verified. The final integrated `pnpm lint`, `pnpm test`,
`pnpm build` and `pnpm test:e2e` runs pass (2026-11-25); API unit tests are 28 suites passed / 4
skipped and 216 tests passed / 12 skipped, web unit tests 2 passed, and browser E2E 11 passed. The
full opt-in live TiDB Cloud suite passed **19 suites / 114 tests** on 2026-11-24, and running-API
smoke checks passed **6/6** including the Phase 7/8 module-status check. Migration
`20261123000000_phase7_advanced` is applied and `prisma migrate status` reports the schema is up to
date. Evaluation-currentness, history, proctor-token, alert-dedupe, rank, CSV and certificate
correctness defects found during audit were fixed. Real third-party outbound journeys remain
unexecuted; see the [Phase 7 report](reports/phase-07.md).

## Phase 8 checklist

- [x] k6 candidate-flow and spike scripts plus documented staging-only runbook
- [x] ZAP baseline config, Semgrep rules, security CI workflow and local smoke checks
- [x] Penetration-test plan and independent-review checklist templates
- [x] Encrypted DR backup/verify/restore CLI and staging-only rehearsal runbook; build/lint verified
- [x] Local API smoke checks executed and evidence recorded under `evidence/phase-08/`
- [x] Passive ZAP baseline executed locally: 0 FAIL, 1 informational warning; raw report retained
- [x] Encrypted DR backup created and verified (integrity/readability only; no restore)
- [x] k6 load/spike run with recorded results and thresholds (5 VUs/30s and 20 VUs/5m; all thresholds passed)
- [x] DR restore → health/smoke rehearsal with recorded RPO/RTO (empty local staging target; 6/6 smoke checks passed)
- [x] Corrected Semgrep tracked-file scan: 0 findings; initial 183 rule false positives triaged
- [x] Semgrep untracked-source run: 0 findings
- [x] Trivy filesystem/secret scan completed with dev dependencies: 0 final findings; all 7 initial
      findings remediated and recorded in `evidence/phase-08/trivy-triage.md`
- [x] Integrated final verification recorded after all code changes
- [ ] Independent security review sign-off
- [ ] Penetration test execution and sign-off

⁸ Phase 8 is **internally complete, external assurance incomplete**. `tests/load/k6/`,
`tests/security/`, `.github/workflows/security-verification.yml`, `scripts/dr/README.md` and the DR
CLI are implemented. On 2026-11-24, smoke checks passed 6/6; the passive local ZAP baseline
recorded 0 FAIL / 1 informational warning; corrected tracked and untracked Semgrep scans recorded
0 findings; the encrypted DR backup/restore rehearsal passed smoke checks (observed RTO 3 seconds,
declared-scenario RPO 41 seconds); and the k6 smoke/load runs met their thresholds (0% failed
requests, p95 208.19 ms, 100% checks on the 20-VU load run). On 2026-11-25, Trivy v0.76.2 completed
with **0 vulnerabilities and 0 secrets** after all dependency findings were remediated, and the
integrated lint/test/build/E2E verification passed. Only an authorised penetration test and an
independent security-review sign-off remain, and neither can be self-certified. See the
[Phase 8 report](reports/phase-08.md) and raw evidence under `evidence/phase-08/`.

## Integrated final verification (2026-11-25)

All internally executable work across Phases 1–8 was verified together after the residual items were
integrated:

- `pnpm install`, `pnpm lint`, `pnpm test`, `pnpm build`, `prisma validate` and `pnpm test:e2e` pass.
- API unit tests: **28 suites passed / 4 skipped**, **216 tests passed / 12 skipped**. Web unit tests:
  **2 passed**. Browser E2E: **11 passed**.
- Trivy v0.76.2 filesystem scan with dev dependencies: **0 vulnerabilities, 0 secrets**; the initial
  HIGH and MEDIUM findings were all remediated through pnpm overrides.
- The only build advisory is Vite’s non-blocking >500 kB chunk-size notice.
- Full raw results are in
  [`evidence/phase-08/final-verification.md`](../../evidence/phase-08/final-verification.md) and
  [`evidence/phase-08/trivy-triage.md`](../../evidence/phase-08/trivy-triage.md).

The live TiDB Cloud suite remains the dated 2026-11-24 evidence (19 suites / 114 tests); it was not
rerun in the final pass because Redis was unavailable. Independent security review and authorised
penetration-test sign-off remain external dependencies.

## TiDB Cloud migration note (2026-11-22, extended 2026-11-24)

The database is now a TiDB Cloud Serverless cluster (MySQL-compatible, TLS required) instead of
local PostgreSQL. The shared schema remains, but PostgreSQL RLS was replaced by application-level
tenant scoping in `PrismaService`; the old RLS SQL is archived under
`apps/api/prisma/legacy-postgres/`. The nine former `String[]` columns are nullable `Json`, UUIDs
are `VARCHAR(36)`, and the applied migrations are `20261122000000_init`, the additive
`20261122120000_admin_integration_support`, `20261122130000_exam_integrity` and
`20261123000000_phase7_advanced`.
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

# Phase 7 report — AI evaluation, proctoring, advanced reporting and certificates

**Date:** 2026-11-23 to 2026-11-25  
**Status:** Code complete and locally verified, including browser E2E. Real third-party provider
journeys remain unexecuted.

## Final verification (2026-11-25 integrated pass)

- `pnpm lint` — passed.
- `pnpm test` — passed: API **28 suites passed / 4 skipped**, **216 tests passed / 12 skipped**;
  web **2 tests passed**.
- `pnpm build` — passed (Vite only reports the existing >500 kB chunk-size advisory).
- `pnpm --filter @examnexus/api prisma validate` — passed.
- `pnpm --filter @examnexus/api exec prisma migrate status` — "Database schema is up to date!"
  with four migrations, including `20261123000000_phase7_advanced`.
- `pnpm test:e2e` — **11/11 passed**, including four Phase 7 journeys: evaluation queue with advisory
  suggestions and human review, proctoring investigation/decision, advanced reports/CSV, and
  certificate verification links.
- Opt-in live TiDB Cloud suite (2026-11-24, with Redis started):
  `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand` — **19 suites / 114 tests passed**.
  This includes the new `phase7.integration.spec.ts` flow: start attempt → register proctor session →
  ingest advisory event → save subjective answer → submit → review with AI suggestion → human mark →
  publish → issue certificate → public verification → PDF → proctoring detail. It was not rerun in
  the 2026-11-25 pass because Redis was unavailable.
- Running-API smoke checks: `node tests/security/smoke-checks.mjs` — **6/6 passed**, including the
  Phase 7/8 module-status check. Evidence: `evidence/phase-08/smoke-checks.json`.

A nested-transaction defect found during live verification (audit write inside a tenant transaction
opened a second transaction and caused a TiDB lock-wait timeout) was fixed in
`apps/backend/src/common/services/audit.service.ts`; it now reuses the caller's transaction under an
elevated scope. A regression test was added.

## Features completed

### AI-assisted and human evaluation

- Objective-only attempts still auto-publish at submit; subjective answers remain `PENDING` until
  reviewed and approved. Candidate result reads expose only `PUBLISHED` results.
- `Evaluation.questionId` supports per-question evaluation records.
- Deterministic, explainable AI suggestions are **suggestion-only**: they never change an answer or
  score. Only a `COMPLETED` human evaluation affects the result.
- Review supports blind mode, rubric breakdowns, rationales, feedback, revision and result
  versioning.

### Proctoring

- Registered sessions/devices, server-issued 30-minute HMAC session tokens, heartbeat and rotation,
  advisory event ingestion, explainable rule correlation, severity weights, five-minute time window
  and human investigation/review/appeal status.
- Mismatched session tokens persist evidence without rolling back legitimate assessment writes;
  duplicate high-risk alerts are deduplicated. **No automatic disqualification** and no browser-level
  claim of cheat-proofing. A frontend advisory hook emits browser events only when explicitly wired
  into a candidate attempt.

### Advanced reporting

- Tenant examination analytics from persisted attempts, answers, evaluations, results, risk
  assessments and certificates: score distribution, question accuracy, pass rate, pending
  evaluations, average risk and certificate counts.
- CSV export for `exams`, `results`, `questions`, `risk` and `certificates`, permission-gated and
  tenant-scoped. No fabricated metrics.

### Certificates

- Issued only from published, passing results.
- Random public verification code; public verification returns validity and non-sensitive details.
- Generated single-page PDF, tenant-scoped download, revocation and audit records.

## Correctness fixes from the final audit

- Evaluation reads now use the current evaluation for an attempt; accepted marks are immutable and a
  separate history records all changes. Reopening requires explicit moderation.
- Publication refuses subjective results without a completed reviewed evaluation; candidate results
  remain visible only when `PUBLISHED`. Reopening a published result unpublishes it and audits the
  action.
- `GET /advanced/results/rank/:examinationId` is read-only; a separate protected `POST` persists rank
  rows from the latest published results.
- CSV exports neutralise formula-injection prefixes. Report counts use current evaluation records.
- Certificate public verification links include the code and return accurate valid/revoked/
  not-found status.
- Added `evaluation-integrity.spec.ts` regression coverage and the frontend advisory proctoring hook.

## Files and modules created or changed

```
packages/shared/src/{enums,index,permissions,phase7}.ts
apps/backend/prisma/schema.prisma
apps/backend/prisma/migrations/20261123000000_phase7_advanced/migration.sql
apps/backend/src/app.module.ts
apps/backend/src/modules/advanced/{advanced.module,dto,ai-evaluator,risk-engine,
  grading helpers via examinations/grading.ts,evaluation.service,evaluation.controller,
  results.service,results.controller,proctoring.service,proctoring.controller,
  reports.service,reports.controller,certificates.service,certificates.controller,
  certificate-pdf,score-reconciliation,advanced.spec,phase7.integration.spec}.ts
apps/backend/src/modules/examinations/attempts.service.ts
apps/backend/src/common/services/audit.service.ts,audit.service.spec.ts
apps/backend/src/modules/modules.controller.ts
apps/frontend/src/features/advanced/** + App.tsx/AppShell.tsx/navigation.ts/LoginPage.tsx
docs/api/index.md, docs/development/roadmap.md, docs/development/reports/phase-07.md
```

## Database changes

`20261123000000_phase7_advanced` adds evaluation/result/proctor/certificate fields and indexes while
preserving existing data. It was generated with `prisma migrate diff` and applied with
`prisma migrate deploy` because `prisma migrate dev` cannot create a shadow database on TiDB Cloud.
Prisma client generation succeeded. Application-level tenant scoping remains in `PrismaService`;
PostgreSQL RLS is archived legacy only.

## APIs

See [API documentation](../../api/index.md#phase-7-tenant-advanced-workflows-api-v1-advanced).
New route groups: `/api/v1/advanced/evaluations`, `/advanced/results`, `/advanced/proctoring`,
`/advanced/reports` and `/advanced/certificates` (including the public `/verify` endpoint).

## Tests and results

- Focused deterministic unit tests cover AI suggestions, risk classification/correlation, certificate
  PDF bytes, result publication guards and audit transaction reuse.
- `pnpm test` and the full opt-in live database suite passed as recorded above.
- The earlier targeted Phase 7 run initially failed because a test fixture used a fixed 2026-01-01
  timestamp outside the engine's rolling five-minute window; the fixture was corrected and the
  targeted run then passed (8 tests, 1 live test skipped outside `RUN_DB_TESTS=1`).

## Security issues

- Candidate result exposure is gated by `PUBLISHED`; proctor and evaluation routes require tenant
  context and permissions/ownership; public certificate verification exposes only verification fields.
- AI suggestions cannot award marks; human review is mandatory for subjective scoring.
- Browser events are advisory and auditable; they never automatically disqualify a candidate.
- Audit writes now reuse an active transaction instead of deadlocking; no passphrase, connection URL,
  row content or secret is logged by the Phase 7 code.
- Proctor tokens are server-issued and expire; token mismatch evidence is persisted without losing
  the original assessment, and alert delivery is routed through the Phase 6 alert dispatcher.
- Remaining: no claim of cheat-proofing; browser events are advisory and require human review. Real
  third-party provider journeys are outside the local verification scope.

## Run instructions

```bash
pnpm install
pnpm --filter @examnexus/shared build
pnpm --filter @examnexus/api prisma:generate
pnpm --filter @examnexus/api exec prisma migrate deploy   # applies Phase 7 migration if pending
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand
```

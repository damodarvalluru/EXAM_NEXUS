# Phase 4 report — Question bank, examination engine and candidate delivery

**Date:** 2026-11-22  
**Status:** Code complete. Build, lint, unit tests, opt-in live tenant-isolation tests and an opt-in live
candidate-to-result database flow all pass. Redis/Docker are unavailable in this environment, so
login/session and browser E2E journeys were not executed.

## Final integrated status addendum (2026-11-25)

Browser E2E now covers login, role destinations and the candidate start/autosave/submit journey, and
all integrated checks pass. Phase 7 proctoring and manual subjective-evaluation journeys are covered
in the Phase 7 report. See
[`evidence/phase-08/final-verification.md`](../../../evidence/phase-08/final-verification.md).

## Final integration verification (2026-11-22)

This section supersedes the historical availability and test totals below.

- Frozen published-snapshot `contentHash`, attempt `versionId` binding, a stored submission receipt
  and a unique answer index were implemented and verified; targeted exam grading tests passed
  **10/10**.
- The earlier "no migration was needed" statement below describes the original Phase 4 scope. The
  conditional migration `20261122130000_exam_integrity` was subsequently applied (because an earlier
  failed attempt had already added `contentHash`), alongside `20261122000000_init` and
  `20261122120000_admin_integration_support`; `prisma migrate status` → "Database schema is up to
  date!".
- Redis is up (`docker exec examnexus-redis redis-cli ping` → `PONG`). The full opt-in live DB suite
  passed: `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand` → 16 suites, 103 tests.
  Final checks passed: `pnpm lint`, `pnpm test` (API 14 suites passed / 2 skipped, 93 tests passed /
  10 skipped; web 2 tests passed), `pnpm build` and
  `pnpm --filter @examnexus/api exec prisma validate`.
- The API boots successfully after importing `CommonModule` into `ExaminationsModule` so
  `AuditService` resolves; `/health/ready` returns 200 with database up (609 ms), redis up (1 ms)
  and storage up.
- Residual/not claimed: browser E2E automation, proctoring, manual subjective evaluation (Phase 7),
  real third-party outbound calls, production alerting/on-call/SLA and paid-billing provider actions.

## Features completed

- Tenant-isolated question bank management: banks, up to 200 questions per create request, options,
  difficulty, objective-answer validation, updates and safe deletion of unused questions.
- Examination authoring: drafts with sections, security policy, scheduling fields, pass marks,
  randomisation flags and negative marking. Publishing validates the question set and writes an
  immutable `ExaminationVersion` snapshot with a SHA-256 hash.
- Candidate eligibility windows and candidate portal account creation: a real `User` account,
  membership, `CANDIDATE` role and `Candidate.userId` link are created together; no mock accounts.
- Examination engine: server-authoritative start/expiry/submission, seeded stable question and option
  order, answer autosave with idempotency keys, answer payloads stripped of correctness, duplicate-safe
  submit receipts, automatic grading for objective types and `null` marks for manual evaluation.
- Candidate portal screens: available exams with availability reasons, timed attempt workspace,
  debounced autosave, submission receipt and result display.
- Organisation screens: examination management, question banks, live monitoring (five-second polling),
  evaluation queue, eligibility selection and candidate credential provisioning.
- Authenticated, attempt-scoped Socket.IO channel with tenant/ownership/monitor authorisation and
  clock/state events. Global HTTP guards now explicitly skip WebSocket contexts so the gateway owns
  realtime authentication.
- Navigation, module status and header badge updated to reflect Phases 2–4 implementation.

## Features pending

- Browser-level proctoring, AI evaluation, certificates and advanced reporting are Phase 7 scope.
- Redis-backed rate limiting and token replay checks still require a Redis instance or managed
  equivalent; Docker is unavailable locally.
- No Playwright/E2E suite exists. WebSocket event delivery was verified by code/compile checks, not
  by a browser client integration run.
- Manual evaluation workflows for subjective answers are intentionally deferred to Phase 7; current
  grading leaves their marks null rather than fabricating a score.

## Files and modules created or changed

```
packages/shared/src/{examinations,enums,index}.ts
apps/api/src/modules/examinations/{examinations.service,attempts.service,examinations.controller,
  candidate.controller,examinations.module,grading.ts,grading.spec.ts,
  examinations.integration.spec.ts,dto/examination.dto.ts}
apps/api/src/modules/realtime/{realtime.gateway,realtime.module}.ts
apps/api/src/common/guards/{jwt-auth,tenant,permissions,step-up}.guard.ts
apps/api/src/database/{tenant-scope.ts,tenant-scope.spec.ts,tenant-scope.integration.spec.ts}
apps/api/src/modules/modules.controller.ts
apps/web/src/features/examinations/{ExaminationManagementPage,QuestionBankPage,CandidatePortalPage,
  MonitoringPages}.tsx
apps/web/src/{App.tsx,app/AppShell.tsx,config/navigation.ts,lib/api-client.ts}
apps/web/src/features/auth/LoginPage.tsx
apps/web/src/features/organisations/TenantPages.tsx
docs/api/index.md, docs/development/{roadmap,reports/phase-04.md}, README.md
```

## Database changes

No migration was needed: the Phase 1 schema already contains banks, questions, versions, sections,
security policies, attempts, answers, submissions, results and security events. Runtime verification
created and removed temporary approved organisations, users, candidates, banks, questions,
examinations, versions, eligibility rows, attempts, answers, submissions and results. This was true
of the original Phase 4 scope; see the 2026-11-22 section above for the subsequently applied
conditional `20261122130000_exam_integrity` migration (frozen published-snapshot `contentHash`,
attempt `versionId` binding, stored submission receipt and unique answer index).

A live test exposed a tenant-extension bug: compound Prisma unique keys such as
`examinationId_version` were passed to `count()` as a nested object. `tenantRowExists()` now flattens
compound unique keys into scalar predicates before the ownership count.

## APIs implemented

See [`docs/api/index.md`](../../api/index.md) for the full organisation, candidate and `/live`
contracts. All examination endpoints are tenant-scoped; organisation routes enforce `org.*`
permissions; candidate routes resolve the linked candidate profile from the verified principal.
`PUT /candidate/attempts/:id/answers` and `POST /candidate/attempts/:id/submit` are idempotent.

## Tests executed and results

| Check | Result |
| --- | --- |
| `pnpm --filter @examnexus/shared build` | Passed |
| `pnpm lint` | Passed (API + web TypeScript) |
| `pnpm test` | Passed — 15 API unit tests (5 live tests skipped) + 2 web tests |
| `pnpm build` | Passed (Nest build + Vite production build) |
| `prisma validate` | Passed |
| `prisma migrate status` | Passed — `20261122000000_init` applied |
| `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand` | Passed — 20/20 including live tenant isolation and the full candidate-to-result flow |
| Live flow assertions | Correct answer scored 10/10, receipt hash SHA-256, duplicate submit returned the same submission id, result score 10/10 |

Redis/Docker are unavailable, so no authenticated HTTP/browser E2E login flow was executed. The live
database tests call the same services used by the controllers with a verified principal and real
TiDB Cloud records.

## Security issues identified

1. Tenant isolation remains application-level because TiDB Cloud has no PostgreSQL RLS. The query
   extension fails closed and all live isolation checks pass, but a future data-layer bypass would be
   dangerous; code review must keep all tenant reads inside `withTenant()`.
2. Candidate correctness data is filtered in the delivery mapper. Any new question endpoint must use
   `QuestionView`/`AttemptView` rather than returning raw Prisma rows.
3. Answer and submit idempotency keys are stored per attempt/tenant. Clients must keep keys stable
   across retries; a new key intentionally creates a new answer version.
4. Realtime tokens are accepted in the Socket.IO auth/header/query handshake. Token-in-query can leak
   through proxies/logs; production clients should prefer `auth.token` over the query parameter.
5. Browser-proctoring controls are advisory only. The current policy fields are stored and published
   in snapshots but no browser enforcement/AI monitoring is claimed in Phase 4.
6. Non-production verification/invitation/reset token behaviour remains as documented in earlier
   phases and must be disabled in production configuration.

## Instructions to run

Follow [`docs/development/getting-started.md`](../getting-started.md). Phase 4 setup:

1. Sign in as an organisation administrator and create a question bank at `/org/question-bank`.
2. Add at least one objective question, then create a draft at `/org/examinations` referencing its
   question id and publish it.
3. Enable portal credentials for a candidate from the examination page, then open
   `/candidate/exams` in a separate authenticated session.
4. Start the exam, answer questions (autosave is debounced), submit and review the receipt/result.
5. Open `/org/live-monitoring` to watch attempt state and `/org/evaluation` to review graded queues.
6. To run the opt-in live database verification:
   `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand`.

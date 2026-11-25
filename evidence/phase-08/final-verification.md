# Integrated final verification

**Date:** 2026-11-25  
**Scope:** all eight roadmap phases after integration of the Phase 1–8 residual work.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm install` | Passed. Supply-chain age policy satisfied; no AWS SDK entries and no rejected exceptions. |
| `pnpm lint` | Passed (`@examnexus/api` and `@examnexus/web` TypeScript checks). |
| `pnpm test` | Passed. Shared: no-op. API: **28 suites passed / 4 skipped**, **216 tests passed / 12 skipped**. Web Vitest: **1 file / 2 tests passed**. |
| `pnpm build` | Passed. Shared, NestJS API and Vite SPA built successfully. Vite reports only the existing >500 kB chunk-size advisory. |
| `pnpm --filter @examnexus/api exec prisma validate` | Passed: “The schema at prisma/schema.prisma is valid 🚀”. |
| `pnpm test:e2e` | Passed: **11/11** Chromium tests across auth, organisation, candidate, Phase 7 and admin journeys. |
| Trivy v0.76.2 filesystem scan with `--include-dev-deps` | Passed: **0 vulnerabilities, 0 secrets**. See `trivy-fs.json`, `trivy-fs.sarif` and `trivy-triage.md`. |

The frontend unit-test configuration was corrected to exclude `e2e/**` from Vitest; Playwright specs
are now collected only by `playwright test`.

## Evidence retained from 2026-11-24

The following executed artifacts remain in `evidence/phase-08/`:

- Running-API smoke checks: **6/6 PASS** (`smoke-checks.json`).
- Passive local ZAP baseline: **0 FAIL / 1 informational warning** (`zap-baseline.*`).
- Corrected tracked and untracked Semgrep runs: **0 findings** (`semgrep.sarif`,
  `semgrep-untracked.sarif`; initial 183 false positives are retained in `semgrep-initial.sarif`).
- k6 local load/spike runs: all recorded thresholds passed (`load/`).
- Encrypted DR backup/verify and restore→smoke rehearsal: recorded with RTO/RPO figures (`dr/`).
- Live TiDB Cloud opt-in suite: **19 suites / 114 tests passed** on 2026-11-24.

The live database suite was not rerun in this final pass because no Redis listener is available
(`localhost:6379` → `ECONNREFUSED`) and the Docker daemon cannot be reached. The final pass therefore
reports unit, browser E2E, static security and build verification after all code changes, while the
live-database result remains the dated 2026-11-24 evidence.

## Not self-certified

- Independent security review sign-off: requires a named independent reviewer.
- Authorised penetration-test execution and sign-off: requires written scope authorisation, a staging
  target, accounts and a test window.

These items are not represented as complete; the templates remain under `docs/security/`.

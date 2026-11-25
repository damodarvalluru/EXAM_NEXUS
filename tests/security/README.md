# Security verification tooling (Phase 8)

These are **tools and repeatable commands**, not proof that a penetration test, scan or review has
passed. No findings, results, dates or sign-offs are asserted here. Save real outputs under
`evidence/phase-08/` and record the target, build SHA, tool version and operator alongside them.
Run against staging/demo unless a written authorisation explicitly covers another target.

## Prepare evidence directory

```powershell
New-Item -ItemType Directory -Force evidence/phase-08 | Out-Null
```

## 1. OWASP ZAP baseline (passive crawl)

The config file `tests/security/zap-baseline.conf` is **tab-separated** (ZAP's baseline format). It
excludes `/docs`, `/health/live` and `/health/ready`, and marks security-relevant rules as `FAIL`.

Local ZAP install:

```powershell
zap-baseline.py -c tests/security/zap-baseline.conf -t http://localhost:3000 `
  -r evidence/phase-08/zap-baseline.html `
  -J evidence/phase-08/zap-baseline.json `
  -w evidence/phase-08/zap-baseline.md
```

Docker (no local Python/ZAP install):

```powershell
docker run --rm -v "${PWD}:/zap/wrk:rw" -w /zap/wrk ghcr.io/zaproxy/zaproxy:stable `
  zap-baseline.py -t http://host.docker.internal:3000 `
  -c tests/security/zap-baseline.conf `
  -r evidence/phase-08/zap-baseline.html `
  -J evidence/phase-08/zap-baseline.json `
  -w evidence/phase-08/zap-baseline.md
```

On Linux, add `--add-host host.docker.internal:host-gateway` to the Docker command if needed.

Exit codes: `0` success, `1` at least one FAIL, `2` warnings only, `3` scan/setup failure. A baseline
is passive: it does **not** log in, does **not** test tenant isolation and does **not** send attack
payloads. Authenticated and tenant-specific scans need a ZAP context file (`-n <context>.context`
with `-U <user>`), credentials from environment variables and a separate authorised run.

A passive local baseline was executed on 2026-11-24 with exit `2`, `FAIL-NEW: 0`, `WARN-NEW: 1` and
`PASS: 67`; the informational warning concerned cacheability of 404 `/robots.txt` and
`/sitemap.xml` responses. Raw output is under `evidence/phase-08/`. This is not a penetration test.

## 2. Semgrep (source rules)

```powershell
python -m pip install semgrep
semgrep scan --config tests/security/semgrep.yml --metrics=off `
  --exclude=node_modules --exclude=dist --exclude=.git --exclude=evidence `
  --sarif --output evidence/phase-08/semgrep.sarif `
  apps/backend/src apps/frontend/src packages/shared/src tests scripts
```

`tests/security/semgrep.yml` contains local rules for raw SQL interpolation, hard-coded secrets,
literal JWT secrets, `eval`/`new Function`, disabled TLS verification and secret logging. The secret
logging rule constrains the logger receiver and log level; an earlier unconstrained version produced
183 false positives on non-logging calls and was corrected. Add public rulesets if desired, for
example `--config p/ci --config p/typescript` (requires network).

A corrected local tracked-file scan on 2026-11-24 completed with **0 findings** across 6 rules and
174 targets; raw output is `evidence/phase-08/semgrep.sarif` and `semgrep.log`. The initial false
positive run is retained as `evidence/phase-08/semgrep-initial.sarif`. Semgrep reported that the scan
was limited to git-tracked files, so an untracked-source run is still required.

## 3. Trivy (filesystem + container image)

```powershell
# Install: choco install trivy -y   (or scoop install trivy)
trivy fs --format json --severity HIGH,CRITICAL `
  --output evidence/phase-08/trivy-fs.json .
trivy image --format json --severity HIGH,CRITICAL `
  --output evidence/phase-08/trivy-image.json examnexus/api:local
```

Replace `examnexus/api:local` with the image/tag actually built for the target environment. Record
the image digest. Filesystem scanning covers manifests/lockfiles; image scanning covers the runtime
filesystem and installed OS packages.

## 4. Smoke checks against a running API

```powershell
node tests/security/smoke-checks.mjs
$env:REPORT_FILE = 'evidence/phase-08/smoke-checks.json'
node tests/security/smoke-checks.mjs
Remove-Item Env:\REPORT_FILE
```

Optional `BASE_URL` (default `http://localhost:3000`) and `TIMEOUT_MS`. The script prints PASS/FAIL
per check, writes JSON to stdout and to `REPORT_FILE` when set, and exits 1 on any failure. If the
API is unreachable it reports a connection error and exits 1 without claiming that checks ran.
The `/api/v1/modules` check now passes: Phase 7 modules are implemented, and Phase 8 reports load
testing and DR tooling as implemented while penetration testing and independent review remain
honestly marked `implemented: false`. Do not edit the check to hide a genuine status regression.

## 5. Evidence and scheduling

- Keep raw tool output (SARIF/JSON/HTML/MD), command lines, tool versions, target URL, build SHA,
  operator name and timestamps in `evidence/phase-08/`. Do not edit raw output after a run.
- `.github/workflows/security-verification.yml` runs Semgrep and Trivy filesystem scans and a ZAP
  baseline on a weekly schedule and via `workflow_dispatch` only. It uploads reports as artifacts.
  Configure `TARGET_URL` as a repository variable/secret for ZAP. ZAP is `continue-on-error: true`.
- CI detection jobs are **not** an independent security review. See
  `docs/security/penetration-test-plan.md` and `docs/security/independent-review-checklist.md`
  for the manual process; sign-off fields there remain blank until actually completed.

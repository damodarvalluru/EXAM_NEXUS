# k6 load and spike tests

These scripts exercise the real candidate journey: login → available exams → start/resume attempt →
read attempt → idempotent answer autosave → idempotent submit.

> **Safety:** both scripts mutate data (they start attempts and submit them). Run them **only**
> against a dedicated **staging/demo database** seeded with a candidate eligible for `EXAM_ID`.
> **Never** point `BASE_URL` at production. Credentials are mandatory: the scripts throw during
> initialisation when `TENANT_ID`, `CANDIDATE_EMAIL`, `CANDIDATE_PASSWORD` or `EXAM_ID` is missing.

**No load test results are claimed or recorded here.** These are tools only; numbers must come from
an actual execution and be saved as evidence under `evidence/phase-08/`.

## Install k6

Windows (PowerShell, one of):

```powershell
winget install --id k6 -e
# or
choco install k6 -y
k6 version
```

Docker (no local install):

```powershell
docker pull grafana/k6:latest
docker run --rm grafana/k6 version
```

## Configure environment

PowerShell (repeat in the shell that runs k6):

```powershell
$env:BASE_URL           = 'http://localhost:3000'
$env:TENANT_ID          = '<staging tenant uuid>'
$env:CANDIDATE_EMAIL    = 'candidate@staging.example.test'
$env:CANDIDATE_PASSWORD = '<staging candidate password>'
$env:EXAM_ID            = '<published exam uuid>'
```

Bash / Git Bash:

```bash
export BASE_URL=http://localhost:3000
export TENANT_ID='<staging tenant uuid>'
export CANDIDATE_EMAIL='candidate@staging.example.test'
export CANDIDATE_PASSWORD='<staging candidate password>'
export EXAM_ID='<published exam uuid>'
```

Optional: `VUS` (default `200`) and `DURATION` (default `5m`). The account must not require MFA;
the scripts do not solve TOTP challenges. Access tokens expire after 15 minutes, so keep `DURATION`
below that. The tenant and exam must be seeded with an eligible, non-expired assignment.

## Run

Smoke — 5 VUs for 30 seconds:

```powershell
k6 run -e VUS=5 -e DURATION=30s tests/load/k6/candidate-flow.js
```

Load — 200 VUs for 5 minutes (the defaults, shown explicitly):

```powershell
k6 run -e VUS=200 -e DURATION=5m tests/load/k6/candidate-flow.js
```

Spike — 0 → 200 VUs in 10s, hold 1m, return to 0 in 10s:

```powershell
k6 run -e VUS=200 tests/load/k6/spike.js
```

Docker equivalent (mount the repository and pass the same variables):

```powershell
docker run --rm -v "${PWD}:/scripts" -w /scripts `
  -e BASE_URL="$env:BASE_URL" -e TENANT_ID="$env:TENANT_ID" `
  -e CANDIDATE_EMAIL="$env:CANDIDATE_EMAIL" -e CANDIDATE_PASSWORD="$env:CANDIDATE_PASSWORD" `
  -e EXAM_ID="$env:EXAM_ID" -e VUS=5 -e DURATION=30s `
  grafana/k6 run tests/load/k6/candidate-flow.js
```

The `setup()` phase logs a summary (`tenant`, `exam`, visible exam count, availability, target, VUs,
duration) and fails early if the candidate cannot log in or cannot see `EXAM_ID`. Attempts are reused
when already `IN_PROGRESS`; idempotency keys are SHA-256 hashes of the attempt/question composite so
they stay within the API's 80-character limit and are stable across retries. Once an attempt is
submitted, subsequent VUs keep doing reads and skip the write steps. With a shared candidate whose
exam has `maxAttempts=1`, concurrent VUs legitimately receive `409` from `start`; these expected races
are checked as successful and excluded from `http_req_failed`, while all other 4xx/5xx still fail.

## Thresholds

| Threshold | Meaning | Consequence |
| --- | --- | --- |
| `http_req_failed: rate<0.01` | Fewer than 1% of requests may fail (network errors or 4xx/5xx). | Run is marked failed (k6 exit code 99). |
| `http_req_duration: p(95)<1500` | 95% of requests complete in under 1.5 s. | Run is marked failed. |
| `checks: rate>0.99` | More than 99% of named assertions (status, envelope, receipt, id) pass. | Run is marked failed. |

Thresholds are gates, not proof of capacity. Record the environment (instance size, database tier,
region, build SHA) next to the results.

## Export results

```powershell
New-Item -ItemType Directory -Force evidence/phase-08/load | Out-Null
k6 run -e VUS=200 -e DURATION=5m `
  -e SUMMARY_FILE=evidence/phase-08/load/k6-load-summary.json `
  --out json=evidence/phase-08/load/k6-load.json `
  tests/load/k6/candidate-flow.js
```

`--out json` writes every request/assertion event; `SUMMARY_FILE` tells the script's `handleSummary()`
where to write the aggregate summary (including the setup context). Do not also pass
`--summary-export`: k6 ignores that flag when `handleSummary()` is defined. Commit or attach these
files as evidence, not as a claim that the thresholds were met.

When k6 runs in Docker on Windows/macOS, use `BASE_URL=http://host.docker.internal:<port>`; the
container's own `127.0.0.1` is not the host running the API.

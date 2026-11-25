# ExamNexus penetration test plan (Phase 8)

**Status: plan only.** No penetration test has been performed under this plan. Findings, results,
dates and sign-offs below are intentionally left blank and must be filled from recorded evidence.

Automated internal verification completed on 2026-11-25 is recorded in
[`evidence/phase-08/final-verification.md`](../../evidence/phase-08/final-verification.md); it does
not constitute a penetration test or satisfy the independent sign-off requirement.

## 1. Purpose

Provide an independent, authorised assessment of the ExamNexus staging deployment across
multi-tenancy, authentication, exam delivery, integrations, proctoring and certificate issuance.
The plan maps tests to **OWASP ASVS 4.0** control chapters (V1–V14) and the **OWASP API Security Top
10 (2023)**. Automated tooling (ZAP baseline, Semgrep, Trivy, k6) is complementary and is not a
substitute for this manual assessment.

## 2. Scope

| Item | Detail |
| --- | --- |
| Target URL | PENDING — staging base URL supplied at test start |
| Build / commit | PENDING — record exact SHA and image digest |
| API | `/api/v1/**` (auth, organisations, examinations, candidate portal, admin, integrations, platform monitoring) |
| Platform | `/health/live`, `/health/ready`, `/api/v1`, `/api/v1/modules`, `/docs` |
| Realtime | Socket.IO namespace `/live` (handshake, attempt subscription authorisation) |
| Frontend | React SPA served by the same origin (client-side guards are UX only; backend is the enforcement point) |
| Data | Seeded staging tenants, users, candidates, exams, attempts, integrations and webhook endpoints only |
| Test accounts | PENDING — tenant admin, candidate, monitor, platform admin, low-privilege user, API client |

## 3. Out of scope

- Production systems, production data, customer tenants and real candidate PII.
- Destructive acts: deleting tenants, revoking production credentials, sending real email/SMS,
  triggering real outbound integrations or webhooks to third parties.
- Denial-of-service/volumetric testing outside the separately authorised k6 load test on staging.
- Social engineering, physical security, managed-device/OS-level kiosk bypass (documented BYOD limits).
- Source-code review beyond the automated scans unless separately authorised; a full secure code
  review is tracked in `docs/security/independent-review-checklist.md`.
- Third-party provider platforms themselves (TiDB Cloud, Redis hosting, email/SMS providers).

## 4. Rules of engagement

1. Written authorisation and named testers must be recorded before testing begins.
2. Testing window, emergency contact and stop condition are agreed with the system owner.
3. Use only supplied staging accounts. Do not create, modify or delete data outside the seeded
   test tenants. Do not reuse discovered secrets against any other system.
4. No active scanning or fuzzing of endpoints that trigger external side effects (payment, email,
   SMS, webhook delivery) without explicit per-test approval.
5. Stop immediately on evidence of real customer data, production connectivity, service degradation
   or a critical finding; notify the contact and preserve evidence.
6. All findings, payloads and captured responses are confidential. Store them under
   `evidence/phase-08/penetration-test/` with restricted access. Redact tokens in reports.
7. Retest is performed only after a fix is deployed to staging and the same test case is replayed.

| Field | Value |
| --- | --- |
| Authorisation reference |  |
| Test lead |  |
| Emergency contact |  |
| Agreed testing window (UTC) |  |
| Stop condition acknowledged |  |

## 5. Threat model

| Domain | Assets | Primary threats |
| --- | --- | --- |
| Multi-tenant | Tenant-scoped tables, `tenant_id`, `PrismaService.withTenant` scoping | Cross-tenant read/write via forged IDs, `x-tenant-slug`, raw SQL, background jobs or unscoped service paths. TiDB Cloud has no PostgreSQL RLS, so the application layer is the boundary. |
| Authentication | Argon2id passwords/PINs, TOTP, refresh cookies, step-up tokens | Credential stuffing, MFA bypass, refresh-token reuse, session fixation, PIN brute force, account enumeration. |
| Authorisation | Global/tenant roles, permission catalogue, `PermissionsGuard`, `StepUpGuard` | Missing server-side permission checks, BFLA on admin/integration routes, frontend-only gates. |
| Exam delivery | Immutable published versions, `contentHash`, `versionId`, server clock, autosave, submit receipts | Answer leakage, replayed/different idempotency keys, expired-attempt manipulation, early answer access, grade/result tampering. |
| Integrations / API gateway | Encrypted credentials, HTTPS egress validation, API keys, signed webhooks | SSRF via URL fields/redirects, secret leakage, scope escalation, webhook replay/signature forgery, unsafe consumption of external responses. |
| Proctoring (Phase 7) | Event streams, snapshots, risk scores, retention settings | Unauthorised capture access, excessive data collection, missing consent/retention, privacy leakage in logs or exports. |
| Certificates (Phase 7) | Issued PDFs, signatures, verification data | Forged issuer signature, altered candidate/result claims, acceptance of tampered or revoked certificates. |

## 6. Test cases (mapping and blank results)

| ID | Area | Test case | ASVS 4.0 / API Top 10 | Expected result | Evidence ref | Result |
| --- | --- | --- | --- | --- | --- | --- |
| PT-01 | BOLA/IDOR | Use tenant A credentials to GET/PATCH/DELETE tenant B attempt, exam, candidate, integration and webhook IDs by direct ID substitution. | V4.1, V13.1 / API1 | 404/403, no cross-tenant data, audit event recorded. |  |  |
| PT-02 | Broken auth | Password/PIN login enumeration, wrong-password lockout, TOTP and recovery-code reuse, step-up bypass on credential rotation. | V2.1–V2.10 / API2 | Uniform errors, lockout, single-use challenges, step-up enforced. |  |  |
| PT-03 | BFLA / header trust | Call admin and tenant routes with `x-tenant-slug`, `x-tenant-id` and role claims altered in the request. | V4.2, V13.2 / API1, API5 | Principal derived only from DB-verified session; permission denied. |  |  |
| PT-04 | SSRF | Submit integration test URLs using loopback/link-local/169.254 metadata addresses, DNS rebinding and 30x redirects to private space. | V12.6, V13.6 / API7 | HTTPS-only, DNS/IP validated, redirects revalidated, no internal response returned. |  |  |
| PT-05 | Injection | Fuzz search/sort/date filters and any raw SQL path with `' OR 1=1`, stacked queries and time-based payloads. | V5.2 / OWASP A03:2021, API8 | Parameterised queries only; no data leakage or timing oracle. |  |  |
| PT-06 | XSS | Store payloads in exam titles, candidate names, question content, integration names and PDF metadata; view in admin/tenant/candidate UIs. | V5.3 / OWASP A03:2021 | Contextual encoding, CSP, no script execution in any role. |  |  |
| PT-07 | CSRF | Drive cookie-authenticated refresh, logout, status changes and step-up endpoints from an attacker origin. | V4.2, V13.5 / OWASP A01:2021 | Origin checks and SameSite cookies reject cross-site requests. |  |  |
| PT-08 | Rate limiting | Brute-force login/PIN/OTP/API keys and flood ingest/webhook endpoints from multiple IPs. | V2.2, V11.6 / API4 | Redis counters throttle and lock; no bypass via header rotation. |  |  |
| PT-09 | Session management | Reuse rotated refresh tokens, replay session across IP/user-agent changes, revoke one session and verify family invalidation. | V3.1–V3.9 / API2 | Rotation detects reuse, revocation is immediate, cookies HttpOnly/Secure. |  |  |
| PT-10 | Tenant isolation | Attempt unscoped service/raw-SQL access paths, background job ids and report exports for another tenant's rows. | V4.1, V8.3 / API1 | All reads/writes scoped; exports contain only caller tenant data. |  |  |
| PT-11 | Webhook replay | Replay signed payloads, alter body/timestamp/nonce, use a different endpoint UUID and an expired tolerance window. | V6.1, V13.5 / API10 | HMAC verified over raw body, nonce single-use, tolerance enforced, 401/404. |  |  |
| PT-12 | Certificate forgery | Alter certificate PDF claims, reuse a signature across candidates, attempt verification of revoked/tampered certificates. | V6.3, V12.x / OWASP A08:2021 | Signature/verification fails for any modification; no unauthorised issuance. |  |  |
| PT-13 | Proctoring privacy | Attempt to read another candidate's events/snapshots, disable consent, export PII beyond retention scope. | V8.3, V7.2 / API3 | Owner/tenant scoping, consent enforced, minimal fields, audit trail. |  |  |
| PT-14 | File handling | Traversal/absolute/drive/UNC/null-byte document keys, oversized uploads, disallowed MIME and stored XSS in documents. | V12.1–V12.5 / API4 | Whitelisted prefixes only, size/type enforced, safe object keys. |  |  |
| PT-15 | Transport / headers | Inspect TLS configuration, HSTS, CSP, cache headers, error pages and `/docs` exposure on the target. | V9.1, V14.3 / API8 | TLS 1.2+, no secrets in headers, no stack traces, docs restricted appropriately. |  |  |
| PT-16 | BOPLA / mass assignment | Send extra fields to exam create/publish, eligibility, role assignment and integration mapping endpoints. | V11.1, V13.2 / API3 | DTO allowlists reject unknown/privileged fields. |  |  |
| PT-17 | Logging / error handling | Trigger 4xx/5xx and inspect API logs, audit records and responses for passwords, tokens, cookies or SQL. | V7.1, V7.2 / API8 | Sanitised messages, correlation IDs, no secret material in logs. |  |  |
| PT-18 | Realtime authorisation | Subscribe over `/live` to another tenant's attempt with forged token/attemptId and after session revocation. | V4.1, V13.1 / API1 | Gateway re-verifies principal and attempt ownership; `attempt:error` returned. |  |  |

## 7. Tools

| Tool | Use | Evidence location |
| --- | --- | --- |
| OWASP ZAP (baseline + authenticated context) | Passive crawl, authenticated spider, optional active scan on staging only | `evidence/phase-08/penetration-test/zap/` |
| Semgrep (`tests/security/semgrep.yml`, public rulesets) | Source patterns for injection, secrets, crypto and logging | `evidence/phase-08/penetration-test/semgrep/` |
| Trivy | Dependency/container vulnerability triage | `evidence/phase-08/penetration-test/trivy/` |
| k6 (`tests/load/k6/`) | Availability/resource-consumption context, staged separately | `evidence/phase-08/k6/` |
| Burp Suite / OWASP Proxy / browser devtools | Manual request interception and replay (tester's licensed install) | `evidence/phase-08/penetration-test/manual/` |
| Prisma Studio or read-only SQL client | Verify tenant scope in the staging database after each isolation test | `evidence/phase-08/penetration-test/db/` |

## 8. Evidence template

One record per test case; attach raw request/response captures, timestamps and screenshots.

| Field | Value |
| --- | --- |
| Test ID |  |
| Date/time (UTC) |  |
| Tester |  |
| Target URL / build SHA |  |
| Account / tenant used |  |
| Request (redacted) |  |
| Response (redacted) |  |
| Observed behaviour |  |
| Impact |  |
| Severity |  |
| Evidence file path |  |
| Retest result |  |

## 9. Severity rubric and remediation SLA

| Severity | Definition (examples) | Containment target | Fix target |
| --- | --- | --- | --- |
| Critical | Cross-tenant data breach, auth bypass, RCE, accepted forged certificate or exam result manipulation. | 4 hours | 7 calendar days |
| High | Privilege escalation, SSRF to internal services, stored XSS in admin, webhook replay causing state change. | 24 hours | 30 calendar days |
| Medium | Limited IDOR, missing rate limit, sensitive information disclosure, missing security header. | 72 hours | 90 calendar days |
| Low | Minor hardening gap with no direct exploit path. | Next planned release | Next planned release |
| Informational | Best-practice note; no exploitable issue. | Not required | Documented only |

Clock starts when the finding is acknowledged by the system owner. Exceptions require written
approval recorded in the findings log.

## 10. Remediation and retest

1. Assign an owner and target date for each finding; link the fix commit and deploy SHA.
2. Prefer fixes at the enforcement point (guards, Prisma tenant scoping, signature verification),
   not only in the UI.
3. Add or extend an automated regression test where a deterministic test is possible.
4. Retest the exact PT-ID on staging, attach new evidence, then close with reviewer acceptance.
5. For unresolved Critical/High findings, publish an interim risk acceptance signed by the owner.

## 11. Sign-off (blank until completed)

| Field | Value |
| --- | --- |
| Assessment start date (UTC) |  |
| Assessment end date (UTC) |  |
| Test lead name |  |
| Independent reviewer name |  |
| System owner acceptance |  |
| Total findings (C/H/M/L/I) |  |
| Residual risk statement |  |
| Final report path |  |
| Sign-off date (UTC) |  |

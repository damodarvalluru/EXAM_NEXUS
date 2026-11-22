# Security overview

## Principles

- Deny by default; every endpoint independently verifies identity, account status, membership,
  role, permission and resource/tenant scope.
- Defence in depth: frontend route guards are UX only; backend guards and PostgreSQL RLS are the
  enforcement points.
- No plaintext secrets in source, logs, URLs or frontend bundles.
- Every privileged action produces an audit record with correlation ID.
- Tenant identity is derived only from verified sessions and memberships, never from client headers.

## Implemented controls

| Area | Control | Status |
| --- | --- | --- |
| Password storage | Argon2id via `@node-rs/argon2`, OWASP-recommended parameters | Implemented |
| Super Admin | Password or strong PIN + mandatory TOTP, step-up for PIN rotation | Implemented |
| Tokens | 15-minute JWT access tokens in memory, rotating HttpOnly/Secure/SameSite refresh cookie | Implemented |
| Anti-brute-force | Redis counters, lockout, failed-attempt tracking, session-family revocation on reuse | Implemented |
| RBAC/ABAC | Permission catalogue, global/tenant role maps, server-side permission guard | Implemented |
| Tenant isolation | `withTenant()` service calls plus Phase 1 RLS policies | Implemented in code; RLS runtime unverified |
| Credentials | TOTP secrets encrypted with AES-256-GCM using `ENCRYPTION_MASTER_KEY` | Implemented |
| Audit | Append-only audit log with actor, tenant, request ID, correlation ID and outcome | Implemented |
| Transport/headers | Helmet, CORS, TLS expected at reverse proxy | Implemented in API; TLS deployment-dependent |
| Verification documents | Local disk storage with random object keys and `file_objects` metadata | Implemented; S3 adapter pending |

## Deferred controls

- WebAuthn, SSO/OIDC/SAML, external breached-password checks and risk-based CAPTCHA.
- KMS/Vault-backed envelope encryption and key rotation for production.
- Signed URLs/private buckets when the S3 storage adapter is added.
- Independent penetration testing, OWASP ZAP, Semgrep/Trivy and load testing (Phase 8).
- Verified cross-tenant isolation tests against a live PostgreSQL instance.

## Explicit non-claims

Browser JavaScript, CSS and DNS filtering cannot completely prevent Google Lens, Circle to Search
or OS-level screenshot tools. Only managed-device modes (Android Enterprise kiosk policy with
`screenCaptureDisabled`, Apple Automatic Assessment Configuration, Safe Exam Browser) provide
stronger guarantees, and even those must be tested on real devices and OS versions. BYOD
limitations will be shown to candidates before exam start. No phase report will claim a security
test succeeded without recorded evidence.

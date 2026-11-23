# Security overview

## Principles

- Deny by default; every endpoint independently verifies identity, account status, membership,
  role, permission and resource/tenant scope.
- Defence in depth: frontend route guards are UX only; backend guards and application-level tenant
  scoping in `PrismaService` are the enforcement points on TiDB Cloud.
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
| Tenant isolation | Backend tenant resolution plus application-level scoping through `PrismaService` (no database RLS on TiDB Cloud) | Implemented in code; scoping path under finalisation and unverified against live cross-tenant tests |
| Credentials | TOTP secrets and integration/webhook secrets encrypted with AES-256-GCM using `ENCRYPTION_MASTER_KEY` | Implemented |
| Outbound integrations | HTTPS-only, DNS/IP validation, private-address blocking, redirect revalidation, response-size limits and optional host allowlist | Implemented |
| Webhooks | HMAC-SHA256 signatures bound to timestamp, nonce and raw body; Redis single-use nonce replay protection | Implemented; Redis runtime verification pending |
| API keys | 256-bit random tokens, SHA-256 hashes only, one-time display, scopes, expiry, revocation and request logging | Implemented |
| Audit | Append-only audit log with actor, tenant, request ID, correlation ID and outcome | Implemented |
| Transport/headers | Helmet, CORS, TLS expected at reverse proxy | Implemented in API; TLS deployment-dependent |
| Verification documents | Local disk storage with random object keys and `file_objects` metadata | Implemented; S3 adapter pending |

## Tenant isolation boundary

The shared schema (`tenant_id` on tenant-scoped tables) is unchanged, but PostgreSQL RLS is no
longer available on TiDB Cloud. Isolation now depends on application-level scoping in
`PrismaService`. This is narrower than RLS: it protects callers that use the scoped data-access
path, but raw SQL, scripts or another service with database credentials are not automatically
filtered. The runtime user is least-privilege; the cluster root user is reserved for migrations via
`DIRECT_URL` and must never be used by the API. See the
[TiDB Cloud tenant scoping ADR](../architecture/adr/0003-tidb-cloud-and-application-tenant-scoping.md).

## Deferred controls

- WebAuthn, SSO/OIDC/SAML, external breached-password checks and risk-based CAPTCHA.
- KMS/Vault-backed envelope encryption and key rotation for production.
- Signed URLs/private buckets when the S3 storage adapter is added.
- Independent penetration testing, OWASP ZAP, Semgrep/Trivy and load testing (Phase 8).
- Verified cross-tenant isolation tests against the live TiDB Cloud cluster.

## Explicit non-claims

Browser JavaScript, CSS and DNS filtering cannot completely prevent Google Lens, Circle to Search
or OS-level screenshot tools. Only managed-device modes (Android Enterprise kiosk policy with
`screenCaptureDisabled`, Apple Automatic Assessment Configuration, Safe Exam Browser) provide
stronger guarantees, and even those must be tested on real devices and OS versions. BYOD
limitations will be shown to candidates before exam start. No phase report will claim a security
test succeeded without recorded evidence.

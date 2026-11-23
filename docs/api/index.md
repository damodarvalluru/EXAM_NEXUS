# API documentation

The API is versioned under `/api/v1`. OpenAPI/Swagger UI is generated from NestJS decorators and
served at `/docs` when the API is running.

## Conventions

- JSON request/response bodies; `Content-Type: application/json`.
- Consistent response envelope: `{ "success": true, "data": ..., "meta": { requestId, timestamp, ... } }`
  or `{ "success": false, "error": { code, message, details? }, "meta": { requestId, timestamp } }`.
- Errors use stable `ERROR_CODES` values and never leak stack traces in production.
- List endpoints accept `page`, `pageSize` and `search`; several also accept `status`, `outcome`,
  `action`, `method`, `tenantId`, `from` and `to`.
- Protected routes accept a short-lived JWT access token in `Authorization: Bearer <token>`. The
  opaque refresh token is never returned in a response body; it is set as an HttpOnly cookie named
  `ex_refresh` on `/api/v1/auth`.
- Tenant context is resolved only from DB-verified session and membership data. The
  `x-tenant-slug` header is never trusted as authorisation.
- In non-production environments, one-time verification/invitation/reset tokens are returned in
  responses to make local end-to-end testing possible. Production returns a generic delivery message.

## Authentication (`/api/v1/auth`)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | Public | Password login; returns `AUTHENTICATED` or `MFA_REQUIRED` |
| POST | `/auth/pin` | Public | Strong PIN login for Super Admins with TOTP enrolled |
| POST | `/auth/mfa/verify` | Public | Complete an MFA challenge with TOTP or a recovery code |
| POST | `/auth/refresh` | Public (cookie + origin check) | Rotate the refresh token and issue a new access token |
| POST | `/auth/logout` | Bearer | Revoke the current session and clear the cookie |
| GET | `/auth/me` | Bearer | Current safe user projection with roles and permissions |
| GET | `/auth/sessions` | Bearer | Active sessions for the current user |
| POST | `/auth/sessions/:id/revoke` | Bearer | Revoke one session |
| POST | `/auth/step-up` | Bearer | Obtain a 10-minute step-up proof using password/PIN/TOTP |
| POST | `/auth/mfa/enroll` | Bearer | Begin TOTP enrollment; returns secret and otpauth URI |
| POST | `/auth/mfa/confirm` | Bearer | Confirm TOTP and return one-time recovery codes |
| POST | `/auth/mfa/recovery-codes` | Bearer | Regenerate recovery codes with a current TOTP code |
| POST | `/auth/phone/request` | Bearer | Issue a phone verification OTP (Redis-backed) |
| POST | `/auth/phone/verify` | Bearer | Verify a phone OTP |
| POST | `/auth/password/change` | Bearer | Change password and revoke all sessions |
| POST | `/auth/password/forgot` | Public | Issue a single-use reset token |
| POST | `/auth/password/reset` | Public | Reset a password with a valid token |
| POST | `/auth/verify-email` | Public | Verify an organisation administrator email |

## Organisations (`/api/v1/organisations`)

| Method | Path | Auth / permission | Purpose |
| --- | --- | --- | --- |
| POST | `/organisations/register` | Public | Register an organisation, administrator and optional verification documents |
| POST | `/organisations/invitations/accept` | Public | Accept an invitation and set a password |
| GET | `/organisations/slug/:slug` | Public | Resolve a public organisation profile |
| GET | `/organisations` | `platform.organisations.read` | List organisations with filters |
| GET | `/organisations/:id` | `platform.organisations.read` | Detail with verification history and counts |
| POST | `/organisations/:id/review` | `platform.verification.review` or `platform.organisations.manage` | Approve/reject/suspend/reactivate |
| GET | `/organisations/:id/document?key=` | `platform.verification.review` | Download a stored verification document |
| GET | `/organisations/me/dashboard` | Tenant + `org.dashboard.read` | Canonical live tenant dashboard |
| GET | `/organisations/me` | Tenant + `org.dashboard.read` | Backwards-compatible alias for `GET /organisations/me/dashboard` |
| GET | `/organisations/me/profile` | Tenant + `org.dashboard.read` | Organisation profile (`OrganisationView`), a separate payload from the dashboard |
| PATCH | `/organisations/me` | Tenant + `org.profile.manage` | Update organisation profile/branding |
| GET/POST | `/organisations/me/users` | Tenant + `org.users.read/manage` | Members and invitations |
| POST | `/organisations/me/users/:userId/status` | Tenant + `org.users.manage` | Change member status |
| POST | `/organisations/me/users/:userId/roles` | Tenant + `org.users.manage` | Replace member role assignments |
| GET | `/organisations/me/permissions` | Tenant + `org.roles.read` | Permission catalogue for tenant roles |
| GET/POST | `/organisations/me/roles` | Tenant + `org.roles.read/manage` | Tenant roles |
| PATCH/DELETE | `/organisations/me/roles/:roleId` | Tenant + `org.roles.manage` | Update/delete custom roles |
| GET/POST | `/organisations/me/candidates` | Tenant + `org.candidates.read/manage` | Candidates |
| POST | `/organisations/me/candidates/:candidateId/status` | Tenant + `org.candidates.manage` | Candidate status |
| POST | `/organisations/me/documents` | Tenant + `org.profile.manage` | Upload a verification document (base64, max 10 MB) |

Verification document keys accept both `<prefix>/<uuid>` and the legacy `<prefix>_<uuid>` form for
the narrow whitelist `REGISTRATION`, `ID_PROOF`, `ADDRESS_PROOF`, `ADDITIONAL` and `verification`;
unknown prefixes, traversal, absolute/drive/UNC paths, null bytes, backslashes and nested keys are
rejected.

## Examinations (`/api/v1/examinations`)

All routes require a verified tenant context; organisation routes additionally require the listed
permission. Published examinations are immutable snapshots (`examination_versions`) with a SHA-256
`immutableHash` and a frozen-question `contentHash`; changing questions requires publishing a new
version, and attempts are bound to the published `versionId`.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET/POST | `/examinations/question-banks` | `org.question_bank.read/manage` | List/create question banks |
| POST | `/examinations/question-banks/:bankId/questions` | `org.question_bank.manage` | Add up to 200 questions with options |
| GET | `/examinations/questions` | `org.question_bank.read` | List active questions, optionally `?bankId=` |
| PATCH/DELETE | `/examinations/questions/:questionId` | `org.question_bank.manage` | Update or delete an unused question |
| GET/POST | `/examinations` | `org.examinations.read/manage` | Paginated exam list / create a draft with sections and security policy |
| GET/PATCH | `/examinations/:id` | `org.examinations.read/manage` | Exam detail / update a draft |
| POST | `/examinations/:id/publish` | `org.examinations.manage` | Freeze an immutable version and set LIVE/SCHEDULED |
| POST | `/examinations/:id/status` | `org.examinations.manage` | Transition LIVE/PAUSED/COMPLETED/CANCELLED |
| GET/POST | `/examinations/:id/eligibility` | `org.examinations.read/manage` | Read/replace eligible candidates (publish first) |
| GET | `/examinations/attempts` | `org.live_monitoring` | Attempts for live monitoring, optionally `?examinationId=` |
| GET | `/examinations/:id/attempts` | `org.live_monitoring` | Attempts for one examination |
| POST | `/examinations/candidates/:candidateId/credentials` | `org.candidates.manage` | Create a User account, `CANDIDATE` role/membership and link `Candidate.userId` |

## Candidate portal (`/api/v1/candidate`)

These routes use the authenticated account's linked `Candidate` profile; a tenant user without that
link receives `403`. Correct answers are never serialised into candidate question views.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/candidate/exams` | Assigned exams with server-computed availability reasons |
| POST | `/candidate/exams/:examId/start` | Start/resume an attempt from the published snapshot |
| GET | `/candidate/attempts` | Attempt history |
| GET | `/candidate/attempts/:attemptId` | Attempt with stable question/option order and saved answers |
| PUT | `/candidate/attempts/:attemptId/answers` | Idempotent answer autosave: `{ questionId, answer: { value }, idempotencyKey }` |
| POST | `/candidate/attempts/:attemptId/submit` | Idempotent submit: `{ idempotencyKey, clientTime? }`; returns a receipt hash |
| GET | `/candidate/attempts/:attemptId/result` | Published score, pass mark and result status |

`serverEndAt` is authoritative; expired in-progress attempts are auto-submitted with server-side
grading. Objective question types are graded immediately; subjective types remain `null` for manual
evaluation.

## Realtime (`/live`)

Socket.IO namespace `/live`. The handshake must carry a valid access token in `auth.token`,
`Authorization: Bearer …`, or `token` query parameter; stale sessions are rejected. Global HTTP
guards do not apply to WebSocket events—the gateway re-verifies the principal and authorises each
attempt subscription against tenant, ownership and monitoring permissions.

| Event | Direction | Payload / purpose |
| --- | --- | --- |
| `attempt:subscribe` | client → server | `{ attemptId }`; joins `attempt:<id>` only for the owning candidate or an authorised monitor |
| `attempt:subscribed` | server → client | `{ attemptId, serverTime }` |
| `attempt:clock` | server → client | `{ attemptId, serverTime, serverEndAt, remainingSeconds, reason }` |
| `attempt:state` | server → client | `{ attemptId, status, score, submittedAt }` |
| `attempt:error` | server → client | `{ code, message }` for unauthenticated/forbidden subscriptions |

## Admin (`/api/v1/admin`)

All admin routes require a platform principal and the listed permission.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/admin/overview` | `platform.organisations.read` | Live platform overview metrics |
| GET | `/admin/users` | `platform.users.read` | User list with filters |
| POST | `/admin/users` | `platform.users.manage` | Create a platform user |
| PATCH | `/admin/users/:id/status` | `platform.users.manage` | Change status and revoke sessions when suspended/locked |
| PATCH | `/admin/users/:id/role` | `platform.users.manage` | Change global role |
| GET | `/admin/roles` | `platform.roles.read` | Seeded roles across tenants |
| GET | `/admin/permissions` | `platform.roles.read` | Global permission catalogue |
| GET | `/admin/auth-events` | `platform.auth_events.read` | Authentication event search |
| GET | `/admin/audit-logs` | `platform.audit.read` | Audit trail search |
| POST | `/admin/super-admins/:id/rotate-pin` | `platform.security.manage` + step-up | Rotate a Super Admin PIN |

## Integrations and API gateway (`/api/v1/integrations`)

Tenant routes require a verified tenant context and the listed organisation permission. Status changes,
deletions, credential changes and webhook secret rotation also require step-up authentication. All
outbound integration traffic is HTTPS-only, DNS/IP validated and redirect-revalidated; secrets are
stored as split AES-256-GCM ciphertext, IV and auth tag and are never returned in plaintext.

All paths in this table are relative to the global `/api/v1` prefix: the tenant controller is mounted
once at `/api/v1/integrations/...` (no `/api/v1/api/v1/...` double prefix). The one exception is
platform monitoring, mounted at `/api/v1/platform/integrations/monitoring`.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET/POST | `/integrations` | `org.integrations.read/manage` | List or create tenant integrations |
| GET/PATCH/DELETE | `/integrations/:id` | `org.integrations.read/manage` | Detail, update or delete an integration |
| PATCH | `/integrations/:id/status` | `org.integrations.manage` + step-up | Change lifecycle status |
| POST | `/integrations/:id/credentials` | `org.integrations.manage` + step-up | Store an encrypted credential; plaintext is not returned |
| POST | `/integrations/:id/credentials/:credentialId/rotate` | `org.integrations.manage` + step-up | Rotate a credential |
| DELETE | `/integrations/:id/credentials/:credentialId` | `org.integrations.manage` + step-up | Revoke a credential |
| POST | `/integrations/:id/scopes` | `org.integrations.manage` | Grant integration scopes |
| DELETE | `/integrations/:id/scopes/:permission` | `org.integrations.manage` | Revoke one integration scope |
| POST | `/integrations/:id/test` | `org.integrations.manage` | Perform a real HTTPS connection test |
| POST | `/integrations/:id/sync` | `org.integrations.manage` | Synchronise candidates; supports `dryRun` and field mapping |
| POST | `/integrations/:id/webhook` | `org.integrations.manage` | Create a signed webhook endpoint; signing secret is returned once |
| GET | `/integrations/:id/events` | `org.integrations.read` | Integration/webhook event history |
| POST | `/integrations/:id/events/:eventId/retry` | `org.integrations.manage` | Retry failed webhook deliveries |
| PATCH | `/integrations/webhooks/:endpointId` | `org.integrations.manage` | Enable/disable a webhook endpoint |
| POST | `/integrations/webhooks/:endpointId/rotate` | `org.integrations.manage` + step-up | Rotate a webhook signing secret |
| GET/POST | `/integrations/api/clients` | `org.api.manage` | List or create API clients; client secret is returned once |
| POST | `/integrations/api/clients/:clientId/revoke` | `org.api.manage` + step-up | Revoke a client and all its keys |
| GET | `/integrations/api/keys` | `org.api.manage` | List API keys (prefix only) |
| POST | `/integrations/api/clients/:clientId/keys` | `org.api.manage` | Create a scoped key; token is returned once |
| POST | `/integrations/api/keys/:keyId/revoke` | `org.api.manage` | Revoke an API key |
| GET | `/platform/integrations/monitoring` | `platform.integrations.read` | Cross-tenant integration/API/webhook monitoring |
| POST | `/integrations/ingest/candidates` | `x-api-key` or client credentials with `candidates:write` | Public credential-authenticated candidate ingest |
| GET | `/integrations/api/candidates/:candidateCode` | `x-api-key` or client credentials with `candidates:read` | Public candidate lookup |
| GET | `/integrations/api/webhook-events` | `x-api-key` or client credentials with `webhooks:read` | Public webhook event history |
| POST | `/integrations/webhooks/inbound/:endpointId` | Raw HMAC signature | Public inbound webhook receiver |

Public API routes accept `x-api-key: enx_k_...` or client credentials supplied as HTTP Basic
(`Authorization: Basic …`), `x-client-id` plus `x-client-secret`, or — for candidate ingest only —
`clientId`/`clientSecret` in the JSON body. Client-level scopes derive from active, unexpired keys;
the public routes above enforce `candidates:write`, `candidates:read` and `webhooks:read` respectively.

Webhook deliveries carry `x-examnexus-signature`, `x-examnexus-timestamp` and `x-examnexus-nonce`.
The signature is HMAC-SHA256 over `timestamp.nonce.rawBody`; nonces are single-use in Redis and
timestamps are checked against `WEBHOOK_TOLERANCE_SECONDS` (default 300 seconds). The public inbound
receiver requires a real webhook endpoint UUID at
`POST /api/v1/integrations/webhooks/inbound/:endpointId`; an unknown UUID returns 404 and an
unauthenticated ingest request returns 401.

## Phase 6 administration (`/api/v1/admin`)

All routes require a platform principal and the listed permission. All metrics are computed from
database records on every request.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET/PATCH | `/admin/security/alerts` | `platform.security.read/manage` | Search and update security alerts |
| GET/PATCH | `/admin/security/incidents` | `platform.security.read/manage` | Search and update incidents |
| GET | `/admin/health` | `platform.monitoring.read` | Live database/Redis checks, queues and storage totals |
| GET | `/admin/analytics` | `platform.reports.read` | Cross-tenant analytics for `?range=7d|30d|90d` |
| GET | `/admin/analytics/export` | `platform.reports.read` | CSV export for `?kind=organisations|attempts|alerts` |
| GET | `/admin/notifications` | `platform.monitoring.read` | Notification delivery records |
| GET | `/admin/subscriptions` | `platform.organisations.read` | Organisation subscriptions |
| GET/POST/PATCH | `/admin/support/tickets` | `platform.support.manage` | Support ticket queue and updates |
| GET/PATCH | `/admin/settings` | `platform.configuration.manage` | Platform settings stored in the database |
| GET | `/admin/live/attempts` | `platform.monitoring.read` | Active examination attempts across tenants |

## Platform

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1` | Public | Platform identity |
| GET | `/api/v1/modules` | Public | Honest backend module implementation status |
| GET | `/health/live` | Public | Process liveness |
| GET | `/health/ready` | Public | TiDB Cloud (MySQL protocol) and Redis readiness with latency |
| GET | `/docs` | Public | Generated OpenAPI/Swagger UI |

## Permission enforcement

Global guards run in this order: `JwtAuthGuard` → `TenantGuard` → `PermissionsGuard` →
`StepUpGuard`. `@Public()` bypasses all auth guards; `@RequirePermissions()` and `@RequireStepUp()`
are enforced server-side regardless of frontend state. Super Admin principals receive `['*']`;
tenant principals receive the aggregate permissions of their assigned roles.

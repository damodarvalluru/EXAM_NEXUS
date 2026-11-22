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
| GET | `/organisations/me/dashboard` | Tenant + `org.dashboard.read` | Live tenant dashboard |
| GET/PATCH | `/organisations/me` | Tenant + `org.profile.read/manage` | Organisation profile |
| GET/POST | `/organisations/me/users` | Tenant + `org.users.read/manage` | Members and invitations |
| POST | `/organisations/me/users/:userId/status` | Tenant + `org.users.manage` | Change member status |
| POST | `/organisations/me/users/:userId/roles` | Tenant + `org.users.manage` | Replace member role assignments |
| GET | `/organisations/me/permissions` | Tenant + `org.roles.read` | Permission catalogue for tenant roles |
| GET/POST | `/organisations/me/roles` | Tenant + `org.roles.read/manage` | Tenant roles |
| PATCH/DELETE | `/organisations/me/roles/:roleId` | Tenant + `org.roles.manage` | Update/delete custom roles |
| GET/POST | `/organisations/me/candidates` | Tenant + `org.candidates.read/manage` | Candidates |
| POST | `/organisations/me/candidates/:candidateId/status` | Tenant + `org.candidates.manage` | Candidate status |
| POST | `/organisations/me/documents` | Tenant + `org.profile.manage` | Upload a verification document (base64, max 10 MB) |

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

## Platform

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1` | Public | Platform identity |
| GET | `/api/v1/modules` | Public | Honest backend module implementation status |
| GET | `/health/live` | Public | Process liveness |
| GET | `/health/ready` | Public | PostgreSQL and Redis readiness with latency |
| GET | `/docs` | Public | Generated OpenAPI/Swagger UI |

## Permission enforcement

Global guards run in this order: `JwtAuthGuard` → `TenantGuard` → `PermissionsGuard` →
`StepUpGuard`. `@Public()` bypasses all auth guards; `@RequirePermissions()` and `@RequireStepUp()`
are enforced server-side regardless of frontend state. Super Admin principals receive `['*']`;
tenant principals receive the aggregate permissions of their assigned roles.

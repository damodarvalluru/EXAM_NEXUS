# Phase 5 report — Integration gateway, webhooks and API management

**Date:** 2026-11-22  
**Status:** Code complete. Build, lint and unit tests pass. Live outbound provider calls and
Redis-backed replay/retry journeys require external credentials and a managed Redis instance and were
not executed locally.

## Final integration verification (2026-11-22)

This section supersedes the pending routing/infrastructure statements in the historical record below.

- Integration routes are mounted once under `/api/v1/integrations`; no `/api/v1/api/v1/...`
  double-prefixed route appears in the startup log. The public inbound webhook
  `POST /api/v1/integrations/webhooks/inbound/:endpointId` requires a real endpoint UUID (unknown
  UUID → 404), and unauthenticated `POST /api/v1/integrations/ingest/candidates` → 401.
- Client credentials and scoped API keys work via HTTP Basic, `x-client-id`/`x-client-secret`, or
  `clientId`/`clientSecret` in the ingest body; required scopes are enforced. One-time secrets, real
  `ApiRequestLog` entries and SSRF hardening were verified. Webhook deliveries use
  `x-examnexus-signature`, `x-examnexus-timestamp` and `x-examnexus-nonce`; timestamp tolerance is
  controlled by `WEBHOOK_TOLERANCE_SECONDS` (default 300 seconds). The allowlist variable is
  `INTEGRATION_OUTBOUND_ALLOWLIST` (singular, as read by `apps/api/src/config/configuration.ts`);
  an earlier plural spelling in this report was a documentation error and has been corrected.
- Redis is up (`docker exec examnexus-redis redis-cli ping` → `PONG`). Targeted integration tests
  passed **21/21** and the full opt-in live DB suite passed:
  `RUN_DB_TESTS=1 pnpm --filter @examnexus/api test -- --runInBand` → 16 suites, 103 tests. Final
  checks passed: `pnpm lint`, `pnpm test` (API 14 suites passed / 2 skipped, 93 tests passed /
  10 skipped; web 2 tests passed), `pnpm build` and
  `pnpm --filter @examnexus/api exec prisma validate`. Applied migrations:
  `20261122000000_init`, `20261122120000_admin_integration_support`,
  `20261122130000_exam_integrity`; `prisma migrate status` → "Database schema is up to date!".
- The API boots after importing `CommonModule` into `ExaminationsModule` so `AuditService` resolves;
  `/health/ready` returns 200 with database up (609 ms), redis up (1 ms) and storage up.
- Residual/not claimed: live outbound calls to a real third-party provider (no credentials), browser
  E2E automation, scheduled webhook retry processing, production alerting/on-call/SLA and
  paid-billing provider actions.

## Features completed

- Tenant integration registry with lifecycle states, provider/category metadata, scopes, owner,
  connection/sync timestamps, health state and error counters.
- Encrypted credential vault: plaintext secrets are accepted only at write time, encrypted with
  AES-256-GCM and stored as split `ciphertext`, `iv`, `authTag` and `algorithm` columns; views never
  expose plaintext. Rotation revokes the previous credential and stores a replacement.
- Connection tests and candidate synchronisation use real HTTPS requests. URLs are validated for
  HTTPS, credentials-in-URL, private/link-local addresses and optional hostname allowlist; redirects
  are revalidated and response bodies are size-limited. Sync supports field mapping, dry runs,
  per-record validation and tenant-scoped candidate create/update.
- Scope grants/revocations are stored as integration permissions and mirrored into the integration's
  active scope list.
- Signed webhooks: endpoint creation returns a one-time signing secret; deliveries are HMAC-SHA256
  over `timestamp.nonce.rawBody`, include timestamp/nonce headers, retry with exponential backoff up
  to five attempts, and can be manually retried by an authorised tenant administrator. Endpoint
  enable/disable and secret rotation are supported. Inbound verification helpers and Redis nonce
  replay protection are implemented.
- API gateway: API clients and scoped API keys with 256-bit random tokens, SHA-256 hashes only,
  one-time plaintext display, expiry, revocation, last-used timestamps and request logging. A public
  ingest endpoint accepts `x-api-key` or client credentials and requires `candidates:write`.
- Cross-tenant integration monitoring reports real integration, API-request and webhook-event counts
  from the database.
- Tenant and platform frontend screens with real queries, mutations and permission gates.
- Permission catalogue extended with `org.integrations.read/manage`, `org.api.manage`,
  `platform.integrations.read/manage`; `ORG_ADMIN` receives the tenant permissions.

## Features pending

- Live connection tests/sync against a real third-party provider (no external credentials available).
- Redis runtime verification of nonce replay protection and scheduled webhook retry processing.
- OAuth/OIDC/SAML provider-specific authorization-code flows; the generic bearer/API-key/Basic
  outbound auth adapter and signed webhook framework are in place, but provider-specific token
  exchange UIs are Phase 7/later work.
- Browser E2E automation and cron/worker scheduling for `retryPending()`.

## Files and modules created or changed

```
packages/shared/src/{permissions,integrations,index}.ts
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20261122120000_admin_integration_support/migration.sql
apps/api/src/common/net/outbound-http.service.ts
apps/api/src/common/net/outbound-http.service.spec.ts
apps/api/src/common/webhooks/webhook-signature.ts
apps/api/src/common/webhooks/webhook-signature.spec.ts
apps/api/src/common/common.module.ts
apps/api/src/config/configuration.ts
apps/api/src/database/tenant-scope.ts
apps/api/src/modules/integrations/{integrations.module,integrations.service,integrations.controller,
  credentials.service,credentials.service.spec,webhooks.service,api-management.service,api-key.guard}.ts
apps/api/src/modules/integrations/dto/integration.dto.ts
apps/web/src/features/integrations/IntegrationPages.tsx
apps/web/src/{App.tsx,app/AppShell.tsx,config/navigation.ts}
docs/api/index.md, docs/development/{roadmap.md,reports/phase-05.md}, README.md
```

## Database changes

Additive migration `20261122120000_admin_integration_support` creates `support_tickets`,
`platform_settings` and `api_request_logs`. Integration, credential, permission, webhook endpoint,
webhook event and API client/key tables reuse the Phase 1 schema. All new tenant-scoped models are
registered in `tenant-scope.ts`; API clients/keys are nullable-tenant platform records and are only
queried through explicit tenant predicates or `withElevated()` in the API-key guard. No existing
table or column is altered.

## APIs

See [API documentation](../api/index.md#integrations-and-api-gateway-apiv1integrations). The main
groups are tenant integration CRUD/status, credentials, scopes, test/sync, webhooks/events/retry,
API clients/keys, public API-key candidate ingest and platform integration monitoring.

## Tests and results

- `pnpm --filter @examnexus/shared build` — passed.
- `pnpm --filter @examnexus/api prisma:generate` — passed.
- `pnpm --filter @examnexus/api build` — passed.
- `pnpm --filter @examnexus/web build` — passed.
- `pnpm lint` — passed.
- `pnpm test` — API: 23 passed, 5 skipped (opt-in DB suites); web: 2 passed. Final combined run:
  **25 passed, 5 skipped**.
- New unit tests cover webhook signature acceptance/tampering/staleness, outbound URL SSRF policy
  and AES-256-GCM credential storage/retrieval.
- Opt-in live integration suites remain available with `RUN_DB_TESTS=1` but were not extended with
  external-provider calls.

## Security issues

- No plaintext integration, webhook or API-key secret is returned after creation or stored in the
  database; hashes/encrypted envelopes are used instead.
- SSRF defences cover private/link-local IPs, DNS resolution, redirects and response size. The host
  allowlist is configurable through `INTEGRATION_OUTBOUND_ALLOWLIST` (singular, as read by
  `apps/api/src/config/configuration.ts`); webhook signature timestamp tolerance uses
  `WEBHOOK_TOLERANCE_SECONDS` (default 300 seconds).
- Webhook signatures bind timestamp, nonce and raw body; Redis `SET NX EX` prevents nonce reuse.
- Destructive and secret-changing routes require step-up authentication; sensitive actions are
  written to the audit log.
- Remaining risk: application-level tenant scoping is not a database-level RLS boundary; raw SQL or
  scripts with database credentials bypass it. Redis and external-provider runtime paths are
  unexecuted locally, so no claim of live security validation is made.

## Run instructions

```bash
pnpm install
pnpm --filter @examnexus/shared build
pnpm --filter @examnexus/api prisma:generate
pnpm lint
pnpm test
pnpm build
```

Apply the additive migration with `pnpm --filter @examnexus/api prisma:migrate:deploy` against the
configured TiDB Cloud `DIRECT_URL`, then start the API and web apps. Configure
`INTEGRATION_OUTBOUND_ALLOWLIST` (singular), `WEBHOOK_TOLERANCE_SECONDS` and a managed Redis URL for
production webhook replay protection and retries.

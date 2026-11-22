# System Architecture — ExamNexus

## 1. Scope and forces

The platform must serve many independent organisations (tenants) with their own administrators,
users, candidates, examinations, integrations, branding and history, while a Super Admin control
plane retains platform-wide visibility and control. It must also survive very large concurrent
examination sessions without losing answers or corrupting timing.

Primary forces:

| Force | Architectural response |
| --- | --- |
| Tenant isolation is non-negotiable | `tenant_id` on every tenant table + PostgreSQL RLS + request-scoped tenant context + backend permission checks |
| Millions of candidates, large concurrent sessions | Stateless API instances, connection pooling (PgBouncer), Redis for exam state, partitioned high-volume tables, CDN for static assets, horizontal scaling |
| Answers and timing must never be lost | Server-authoritative attempt state, append-only answer writes with idempotency keys, autosave reconciliation, immutable submissions |
| Integrations are core | Dedicated integration gateway module with connector framework, encrypted credential vault, scoped grants, signed webhooks, SSRF protection |
| Security claims must be evidenced | Audit trail, security event pipeline, risk scoring with human review, documented device limitations |
| Team can ship incrementally | Modular monolith, clear module boundaries, versioned APIs, tests per phase |

## 2. Deployment model

**Selected:** single multi-tenant SaaS control plane, cloud-hosted, hybrid-ready.

All tenants initially share the application fleet and data infrastructure, separated logically.
The data model and deployment configuration keep the option open for dedicated per-tenant
deployments (government/enterprise) without rewriting domain code: every tenant-scoped query is
parameterised by `tenant_id`, and infrastructure is described declaratively (Docker Compose →
Kubernetes/Terraform later).

```
Candidates / Admins / Integrations
              │
      ┌───────▼────────┐
      │ Edge / CDN /   │  Cloudflare WAF, TLS, static SPA, bot/rate controls
      │ WAF            │
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Load balancer  │  L7 routing, WebSocket upgrade, TLS termination
      └───────┬────────┘
     ┌────────┴─────────┐
     │  API fleet (N×)  │  NestJS modular monolith — REST /api/v1 + WS gateway
     └────────┬─────────┘
       ┌──────┼───────────────┬────────────────┐
       │      │               │                │
  PostgreSQL  Redis       Object storage     Workers
 (primary,   (sessions,  (S3/MinIO:          (BullMQ: scheduled exams,
  RLS,        queues,     documents,          reminders, reports, webhooks,
  partitioned exam state, evidence, exports)  cleanup, backups)
  replica)    rate limits)
       │
 Observability: OpenTelemetry → Prometheus/Grafana, Loki, Tempo, Sentry
 Secrets: cloud KMS / HashiCorp Vault (local: env file, never committed)
 Identity: local Argon2id auth + optional Keycloak (OIDC/SAML), TOTP, WebAuthn
```

## 3. Application architecture

The API is a **modular monolith**: one deployable NestJS application containing bounded modules.
It exposes REST APIs (versioned `/api/v1`) and a WebSocket gateway for live monitoring/exam
events. Cross-module communication uses domain events in-process initially; the event interface
is designed so it can be backed by Kafka without changing module code.

### Backend modules

| Module | Responsibility |
| --- | --- |
| `Auth` | Login (password/PIN/SSO), MFA, tokens, sessions, password reset, lockout |
| `Tenancy` | Tenant resolution, RLS context, membership validation |
| `Organisations` | Registration, verification workflow, profile, branding |
| `Users` / `Rbac` | Users, roles, permissions, invitations, ABAC policy hook |
| `Examinations` | Exam definitions, versions, scheduling, sections, security policy |
| `Questions` | Question bank, reusable sets, import, attachments |
| `Candidates` | Candidate records, eligibility, verification |
| `Attempts` | Attempt lifecycle, server timer, autosave, recovery, submission |
| `Evaluation` / `Results` | Auto/manual/blind/rubric evaluation, result approval, certificates |
| `Integrations` | Connector framework, credentials, scopes, sync, health |
| `Webhooks` | Outbound signed delivery, inbound verification, replay protection |
| `Notifications` | Email/SMS/in-app/webhook templates and dispatch |
| `Reports` | Aggregations, scheduled reports, CSV/Excel/PDF exports |
| `Audit` | Tamper-evident audit log, search/export |
| `Security` | Alerts, incidents, risk engine, review workflow, device integrity |
| `Health` | Liveness/readiness, dependency health, metrics |
| `Admin` | Super Admin operations (cross-tenant, step-up authenticated) |

### Frontend architecture

React SPA built with Vite and TypeScript. Feature folders mirror backend modules. Server state
lives in TanStack Query; forms use React Hook Form + Zod; tables use TanStack Table; charts use
Apache ECharts. A small design system (buttons, inputs, cards, tables, dialogs, toasts, skeletons)
provides consistent premium enterprise UI in light/dark modes. Route guards are UX-only; every
route and action is independently authorised by the backend.

## 4. Multi-tenancy and isolation

1. Every request resolves a tenant from a signed session claim (or platform-controlled subdomain),
   never from an untrusted client parameter.
2. Membership, account status and permission are validated before handler execution.
3. The resolved `tenant_id` is applied to the PostgreSQL session as `app.tenant_id` inside a
   transaction; RLS policies on every tenant table filter reads and constrain writes.
4. Prisma client extensions inject this context for all tenant-scoped operations.
5. Super Admin cross-tenant reads use a separate, explicitly elevated context and always emit an
   audit record. There is no generic "disable RLS" path exposed to feature code.

See [ADR-0002](adr/0002-shared-schema-rls.md).

## 5. Examination delivery and reliability

- Attempt state machine: `NOT_STARTED → IN_PROGRESS → SUBMITTED/AUTO_SUBMITTED/TERMINATED`.
- Server is the only authority for start/end times, remaining time and final submission.
- Answers are written with a client-generated idempotency key; duplicate writes are no-ops.
- Autosave runs on an interval and on visibility changes; on reconnect the client reconciles
  against the server's authoritative answer set.
- Submissions are immutable; corrections are new versions. Results are versioned and approved
  before publication.
- High-volume tables (`exam_events`, `audit_logs`, `candidate_answers`) are partitioned by time;
  Redis holds transient attempt state with PostgreSQL as durable fallback.
- Background workers handle scheduled transitions, reminders and stuck-attempt reconciliation.

See [ADR-0003](adr/0003-server-authoritative-exam-state.md).

## 6. Integration gateway

Connectors implement a common interface (authenticate, test, fetch, push, health). Credentials
are envelope-encrypted with a KMS-managed key; plaintext never reaches logs or the frontend.
Outbound calls use allowlists and DNS/IP checks to prevent SSRF. Inbound webhooks verify HMAC
signatures, timestamps and nonces. Each integration is scoped to one tenant and explicit
permissions; revocation immediately invalidates credentials and sessions.

## 7. Security and anti-cheating

Security is layered: platform security (authn/authz/audit), examination security policy
(browser/client modes, session binding), event detection (tab/focus/fullscreen/connection events),
risk scoring (rules + statistics, thresholds per exam), and human invigilator review. Browser
events are signals, never proof. Managed-device modes (Safe Exam Browser, Android Enterprise
kiosk with `screenCaptureDisabled`, Apple Automatic Assessment Configuration) provide stronger
controls; BYOD limitations are disclosed before an exam starts.

## 8. Observability and operations

Structured logs with correlation IDs, OpenTelemetry traces, Prometheus metrics, Grafana dashboards,
Loki log aggregation and Sentry error tracking. Health endpoints distinguish liveness from
readiness (DB/Redis/storage/jobs). Backups are encrypted, integrity-checked and recovery-tested;
a job that merely started is never reported as a successful backup.

## 9. Scaling strategy (ordered, not all at once)

1. Vertical + modest horizontal scaling of stateless API/worker fleets; PgBouncer pooling; indexes.
2. Read replicas and Redis caching for dashboards/reports; partitioned event tables.
3. Dedicated worker pools and queue backpressure for large exam sessions.
4. ClickHouse/Kafka for analytics and event firehose when volume justifies it.
5. Kubernetes/Terraform for automated multi-region deployment when contracts require it.

Every step is gated by measured load tests (k6) and defined performance targets.

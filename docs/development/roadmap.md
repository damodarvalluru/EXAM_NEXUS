# Development roadmap and phase status

Status legend: ✅ complete · 🚧 in progress · ⬜ pending

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Architecture, project setup, database, frontend/backend skeletons, API gateway, infrastructure | ✅¹ |
| 2 | Super Admin auth (password + PIN), MFA, RBAC, audit logging | ✅² |
| 3 | Organisation registration, verification, approval, dashboards, user management | ✅² |
| 4 | Question bank, examination engine, scheduling, candidate portal, delivery | ⬜ |
| 5 | Integrations, API gateway policies, OAuth/webhooks, synchronisation | ⬜ |
| 6 | Complete Super Admin dashboard, analytics, monitoring, security centre | ⬜ |
| 7 | AI evaluation, proctoring, advanced reporting, certificates | ⬜ |
| 8 | Load testing, penetration testing, disaster recovery, independent review | ⬜ |

## Phase 1 checklist

- [x] Requirements analysis and system architecture
- [x] Architecture decision records
- [x] Monorepo structure (pnpm workspaces)
- [x] Full relational schema with tenant keys and RLS SQL
- [ ] Running local infrastructure (Docker Compose) — config written, needs Docker to verify
- [x] NestJS API skeleton with versioning, Swagger, validation, health checks
- [x] React SPA skeleton with design tokens, routing, API client
- [x] CI workflow and pinned dependencies
- [x] Dependency install + build + test verification

## Phase 2 checklist

- [x] Argon2id password/PIN hashing and RFC 6238 TOTP
- [x] Access/refresh/session/MFA/step-up token lifecycle
- [x] Redis-backed rate limits and token replay tracking
- [x] Global auth, tenant, permission and step-up guards
- [x] Super Admin overview, users, roles, auth logs and audit logs
- [x] Frontend login, PIN, MFA, profile/security and protected routes
- [x] API docs, setup instructions and phase report
- [ ] Live RLS/integration/E2E verification (requires Postgres/Redis)

## Phase 3 checklist

- [x] Public organisation registration with administrator and documents
- [x] Verification review workflow and document download
- [x] Live tenant dashboard, profile, users, roles and candidates screens
- [x] Tenant-scoped service calls with backend permission enforcement
- [x] API docs, setup instructions and phase report
- [ ] Live cross-tenant isolation tests and S3 document adapter

¹ Phase 1 code/configuration is complete and verified by build, lint and unit tests. Applying the
migrations and RLS policies to a live PostgreSQL instance still requires Docker or managed services;
see the [Phase 1 report](reports/phase-01.md).

² Phases 2 and 3 are code-complete and pass build, lint and unit tests. Database-backed flows,
RLS enforcement and browser E2E journeys were not executed locally because Docker/Postgres/Redis are
unavailable. See the [Phase 2](reports/phase-02.md) and [Phase 3](reports/phase-03.md) reports.

## Phase reports

Reports are written to `docs/development/reports/` at the end of each phase using the required
format: features completed, pending, files/modules, database changes, APIs, tests/results,
security issues, run instructions.

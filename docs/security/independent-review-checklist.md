# Independent review checklist (Phase 8)

Use this checklist for an independent reviewer who did not implement the code. Every checkbox starts
unchecked; every sign-off and date field starts as **PENDING**. Do not mark an item complete without
a referenced artefact. This checklist is a template, not evidence that a review occurred.

Internal verification completed on 2026-11-25 (lint, unit tests, browser E2E, build, Prisma
validation and Trivy with zero findings) is recorded in
[`evidence/phase-08/final-verification.md`](../../evidence/phase-08/final-verification.md). It does
not substitute for an independent reviewer.

Reviewer: **PENDING** · Review window (UTC): **PENDING** · Overall result: **PENDING**

## 1. Architecture review

- [ ] Confirm the modular-monolith boundaries and module inventory match `docs/architecture/`.
- [ ] Confirm TiDB Cloud (MySQL protocol) tenant scoping design and the superseded RLS ADR are understood.
- [ ] Confirm no database root/`DIRECT_URL` credentials are used by the runtime API.
- [ ] Review trust boundaries: HTTP guards, WebSocket gateway, integration egress, webhook ingress, file storage.
- [ ] Review encryption design: AES-256-GCM fields, key source, rotation and envelope assumptions.
- [ ] Review audit/error design: correlation IDs, append-only records, no secret leakage.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 2. Authentication and authorisation

- [ ] Verify Argon2id parameters, password/PIN policy and TOTP/recovery-code single use.
- [ ] Verify refresh-token rotation, HttpOnly/Secure/SameSite cookie, reuse detection and revocation.
- [ ] Verify global guard order: JWT → Tenant → Permissions → Step-up.
- [ ] Verify Super Admin PIN + mandatory TOTP and step-up on sensitive rotations.
- [ ] Verify RBAC/ABAC permission catalogue and that every privileged route declares a permission.
- [ ] Verify rate limits/lockout cannot be bypassed by header or account rotation.
- [ ] Sample at least 10 protected routes and confirm a low-privilege token is rejected server-side.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 3. Tenant isolation

- [ ] Verify tenant identity is derived only from DB-verified session/membership data, never headers.
- [ ] Verify `PrismaService` scoping is used on every tenant-scoped read and write.
- [ ] Search for raw SQL / unscoped Prisma calls on tenant tables; verify each with a read-only query.
- [ ] Replay cross-tenant ID substitution against attempts, exams, candidates, integrations and reports.
- [ ] Verify background jobs/queues and realtime subscriptions carry and enforce tenant context.
- [ ] Verify exports, dashboards and analytics aggregate only the caller's tenant.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 4. Exam integrity

- [ ] Verify published versions are immutable snapshots with `immutableHash`/`contentHash`.
- [ ] Verify attempts bind to `versionId` and candidate payloads never contain correct answers.
- [ ] Verify server-authoritative clock, expiry auto-submit and question/option order stability.
- [ ] Verify answer idempotency keys and submit receipts prevent replay or duplicate grading.
- [ ] Verify grading rules, pass marks and manual subjective evaluation cannot be client-controlled.
- [ ] Verify audit events exist for start, answer autosave, submit and status transitions.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 5. Proctoring privacy (Phase 7)

- [ ] Verify data minimisation: only documented events/snapshots are collected.
- [ ] Verify candidate notice/consent and BYOD limitations are shown before exam start.
- [ ] Verify retention/deletion policy is implemented and enforced, not only documented.
- [ ] Verify access to proctoring artefacts is tenant-, attempt- and role-scoped.
- [ ] Verify risk scores are explainable and cannot be modified by the candidate.
- [ ] Verify exports/logs do not embed raw biometric or screen content unnecessarily.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 6. Disaster recovery

- [ ] Verify backup env contract: `DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUP_DIR` (see `scripts/dr/README.md`).
- [ ] Verify encryption is AES-256-GCM with random IV/auth tag and checksum sidecar.
- [ ] Verify retention policy and that passphrases are never stored with backups or in source.
- [ ] Verify `backup:verify` validates checksum and decryption.
- [ ] Verify an actual restore into an **empty staging database** and application smoke checks pass.
- [ ] Verify RPO/RTO are measured and recorded from the rehearsal, not assumed.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 7. Load and resilience

- [ ] Verify k6 scripts target staging only and require explicit credentials (fail fast).
- [ ] Review smoke (5 VUs/30s), load (200 VUs/5m) and spike scenarios and their thresholds.
- [ ] Verify thresholds: failure rate <1%, p(95) <1500 ms, checks >99%.
- [ ] Verify the database/Redis/integration behaviour under load is observed, not inferred.
- [ ] Verify no production traffic was generated by any load run.
- [ ] Review exported JSON/summary evidence and record the environment alongside it.

Evidence path: **PENDING** · Reviewer: **PENDING** · Date: **PENDING** · Sign-off: **PENDING**

## 8. Findings log

| ID | Section | Finding | Severity | Evidence ref | Owner | Remediation due | Retest | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FR-01 |  |  |  |  |  |  |  | PENDING |
| FR-02 |  |  |  |  |  |  |  | PENDING |
| FR-03 |  |  |  |  |  |  |  | PENDING |

Reviewer: **PENDING** · Date: **PENDING** · Final sign-off: **PENDING**

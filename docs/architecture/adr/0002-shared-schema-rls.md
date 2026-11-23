# ADR-0002: Shared schema with tenant_id and Row-Level Security

- **Status:** Superseded on 2026-11-22 by the
  [TiDB Cloud and application-level tenant scoping ADR](0003-tidb-cloud-and-application-tenant-scoping.md)
- **Date:** 2026-11-21

> This record is kept for history. The shared-schema and `tenant_id` decisions still stand, but
> PostgreSQL RLS no longer applies: the database is now TiDB Cloud (MySQL-compatible). See the
> superseding ADR for the current tenant isolation approach.

## Context

Unlimited tenants, strict isolation, cost-efficient sharing, and a Super Admin control plane.
Schema-per-tenant would make migrations and analytics costly; database-per-tenant complicates the
central dashboard and early SaaS delivery.

## Decision

Use one shared schema. Every tenant-scoped table has a non-null `tenant_id` referencing
`organisations.id`. PostgreSQL RLS policies use `current_setting('app.tenant_id', true)` to filter
all reads and constrain all writes. The application sets this setting inside a transaction for
each request. Elevated cross-tenant access is a separate, audited capability available only to
Super Admin service code.

## Consequences

Positive: simple migrations, efficient shared infrastructure, defence in depth (application +
database). Negative: a missing tenant predicate in a non-RLS context can be catastrophic;
all tables must be covered by policies and tested. Mitigation: automated cross-tenant isolation
tests, migration lint that fails if a tenant table has no RLS policy, and no raw superuser DB
access in application code.

# ADR-0003: TiDB Cloud and application-level tenant scoping

- **Status:** Accepted
- **Date:** 2026-11-22
- **Supersedes:** [ADR-0002](0002-shared-schema-rls.md) — shared schema remains; PostgreSQL RLS does not

> Numbering note: ADR-0003 was already assigned to "Server-authoritative examination state". This
> record keeps the requested filename and is referenced by title in other docs; future ADRs should
> continue from 0005.

## Context

Phase 1 defined one shared schema with `tenant_id` on tenant-scoped tables, PostgreSQL RLS policies
and a request-scoped database setting as the isolation boundary. The platform now uses a TiDB Cloud
Serverless cluster (`gateway01.us-east-1.prod.aws.tidbcloud.com:4000`, database `examnexus`) speaking
the MySQL 8.0 protocol over required TLS. PostgreSQL-specific mechanisms — `current_setting`-based
RLS, `FORCE ROW LEVEL SECURITY`, `pgcrypto` and local PostgreSQL in Compose — are not available.

The schema was ported accordingly: the Prisma datasource provider is `mysql`, UUID values are
`VARCHAR(36)`, and the nine PostgreSQL `String[]` columns are nullable `Json` columns. PostgreSQL
migrations were replaced by one generated MySQL migration, `20261122000000_init`, applied with
`prisma migrate deploy`. The old PostgreSQL migrations and RLS SQL were preserved under
`apps/api/prisma/legacy-postgres/` as history and are not applied to TiDB Cloud.

`prisma migrate dev` cannot create its shadow database on this cluster, so the development workflow
must separate SQL generation (`prisma migrate diff`) from application (`prisma migrate deploy`).

## Decision

1. Use the TiDB Cloud Serverless cluster as the single durable store. Connections use TLS;
   `DATABASE_URL` and `DIRECT_URL` are `mysql://` URLs with `?sslaccept=strict`.
2. Use two credentials with different privileges. The runtime API uses a least-privilege app user
   in `DATABASE_URL`. Migrations use the cluster root user via `DIRECT_URL` only. The API must never
   use the cluster root user.
3. Keep one shared schema and the `tenant_id` column on every tenant-scoped table. Tenant isolation
   is enforced in application code, with `PrismaService` as the intended single data-access boundary
   for scoped reads and writes. The exact helper implementation is being finalised separately; this
   decision does not assume database-level filtering.
4. Apply schema changes by generating SQL with `prisma migrate diff` and committing it as a new
   migration, then running `prisma migrate deploy`. Do not run `prisma migrate dev` against this
   cluster.
5. Retain the legacy PostgreSQL SQL only as an archive under `apps/api/prisma/legacy-postgres/`.
   Historical phase reports keep their original claims and carry a dated migration note.

## Consequences

Positive: managed, MySQL-compatible storage with TLS; a reproducible migration workflow that does
not require a shadow database; no root credentials in the runtime API; the shared-schema analytics
and deployment model from ADR-0002 is preserved.

Negative — **security tradeoff**: PostgreSQL RLS enforced isolation on *all* access paths, including
raw SQL and any future service that opened a direct connection. Application-level scoping enforces
tenancy wherever the scoped Prisma path is used; a code path that bypasses it (raw SQL, a migration
script, an ad-hoc query or another service) is not automatically tenant-filtered. This is weaker
than the previous database-level guarantee and must not be described as equivalent to RLS.

Mitigations: keep the runtime database user least-privilege, route all tenant data access through
the scoped data-access boundary, review any raw SQL or bypass explicitly, test cross-tenant access
attempts against a live cluster, and audit elevated/platform operations. If a deployment requires
isolation enforced independently of application code, revisit this decision with a different
database or a per-tenant data boundary.

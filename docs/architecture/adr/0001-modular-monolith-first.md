# ADR-0001: Modular monolith first

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

The requirements mention many technologies (Kafka, Temporal, Kubernetes, Keycloak, ClickHouse).
Introducing all of them at project start increases operational risk and slows delivery of the
security-critical core.

## Decision

Implement a single NestJS modular monolith with clearly bounded modules and in-process domain
events. Introduce separate services or infrastructure only after load tests or organisational
requirements justify them.

## Consequences

Positive: simpler transactions, easier tenant-context propagation, faster iteration, one deployable.
Negative: modules must maintain discipline; a poorly behaved module can affect the whole process.
Mitigation: lint boundaries, module-owned data access, async workers for heavy jobs, documented
extraction seams (queue interfaces, event contracts).

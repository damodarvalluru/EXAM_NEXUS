# ADR-0004: First-class integration gateway

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

External application connectivity is a core product feature involving credentials, OAuth/SAML,
webhooks, imports and per-tenant scopes. Bolting it on later would produce insecure shortcuts.

## Decision

Build an `Integrations` module and connector framework in Phase 1 scaffolding, even before the
first connector ships. Credentials are encrypted at rest via envelope encryption; outbound calls
are SSRF-protected; inbound webhooks are signed and replay-protected; every integration is
tenant-owned and scoped.

## Consequences

Positive: security and extensibility. Negative: upfront design cost. Mitigation: start with a
generic HTTP connector plus test connector; add LMS/SIS/HR connectors iteratively with contract
tests.

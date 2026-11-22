# ADR-0003: Server-authoritative examination state

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Network interruptions, refreshes, duplicate submissions and high concurrency must never lose
answers or produce incorrect timing.

## Decision

The backend owns attempt state, start/end timestamps and answer persistence. The browser timer is
display-only and continuously reconciled with the server. Answer writes are idempotent
(client-generated UUID key). Submission is transactional and idempotent; a second submission with
the same key returns the original receipt. Redis caches active state; PostgreSQL is the durable
source of truth.

## Consequences

Positive: reliability and auditability. Negative: more backend round trips; requires careful
reconciliation UI. Mitigation: autosave queue with backoff, WebSocket deltas, explicit recovery
banner on reconnect, load tests that inject disconnections.

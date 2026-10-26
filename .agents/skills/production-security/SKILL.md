---
name: production-security
description: Review or design production hardening for AI applications and backend services, including secrets management, service identity, environment separation, queues/workers, workflow durability, logging, tracing, metrics, audit events, retries, circuit breakers, provider failure handling, deployments, backups, and incident readiness. Use when preparing a system for production, scaling beyond a prototype, or auditing operational security and reliability.
---

# Production Security and Reliability

Security controls must survive real production failure modes.

## Secrets and configuration

Use protected secret storage where appropriate. Separate development, staging and production credentials. Scope provider tokens narrowly and rotate them.

Do not expose secrets to client bundles, logs, model context, generic workers or sandboxes without explicit need.

## Service identity

Authenticate meaningful service-to-service boundaries when compromise of one service should not imply authority of all services.

Prefer scoped workload/service identities over a shared master credential.

## Queues and workers

For asynchronous work define:

- delivery semantics
- idempotency
- retry policy
- exponential backoff and jitter
- timeout
- concurrency
- poison/dead-letter handling
- tenant/context propagation
- audit correlation

## Durable workflows

Use a workflow engine only when the product requires durable multi-step execution, pause/resume, approvals, compensation or long-running state. Do not add one for simple jobs.

## Resilience

For external providers define:

- connect/request timeout
- bounded retry policy
- backoff/jitter
- circuit breaking where useful
- fallback/degradation behavior
- quota/rate-limit handling

## Observability

Provide:

- structured logs
- metrics
- distributed traces where justified
- request/trace IDs
- security events
- AI usage/cost telemetry
- tool/action telemetry

For agent runs measure model latency, tokens/cost, step count, tool latency, tool failures, budget exhaustion and approvals.

## Audit logs

Sensitive operations should record actor, action, resource, policy/approval outcome, timestamp, correlation IDs and result. Protect audit logs from casual modification and avoid storing raw secrets.

## Deployment and environment

Review:

- least-privilege deployment identity
- environment isolation
- protected production configuration
- migration safety
- rollback
- dependency/runtime patching
- backup and restore testing

## Incident readiness

Define how to revoke credentials, disable a tool/provider, stop autonomous runs, block an abusive identity, isolate execution, and trace a sensitive action.

## Additional resources

Read `references/production-checklist.md` for a detailed go-live checklist.

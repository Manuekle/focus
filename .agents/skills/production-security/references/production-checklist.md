# Production Security Checklist

## Secrets
- no secrets in source/client bundles
- environment separation
- scoped credentials
- rotation/revocation path

## Identity
- service boundaries authenticated
- no broad shared master credential
- least privilege

## Jobs
- bounded retries
- backoff + jitter
- timeout
- concurrency limit
- idempotency
- dead-letter/poison handling

## Providers
- timeouts
- quota handling
- degradation/fallback
- circuit breaker where useful

## Observability
- structured logs
- metrics
- trace/request IDs
- security events
- model/tool latency
- token/cost accounting
- action audit trail
- secret redaction

## Deployments
- protected production config
- safe migrations
- rollback
- dependency/runtime patching

## Data
- backups
- restore test
- retention/deletion process

## Incident response
- revoke credentials
- disable tools/providers
- stop autonomous runs
- isolate execution
- identify affected users/resources

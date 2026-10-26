---
name: webhook-security
description: Review or design inbound and outbound webhook security, event authenticity, replay prevention, idempotency, queue handoff, retries, and webhook secret handling. Use whenever external providers send events to the application or the application delivers signed callbacks to other systems.
---

# Webhook Security

Treat webhook endpoints as unauthenticated Internet entry points until provider authenticity is cryptographically verified.

## Inbound flow

Prefer:

```text
Provider
-> HTTPS endpoint
-> raw-body capture when required
-> signature verification
-> timestamp/freshness validation
-> payload schema validation
-> event deduplication
-> enqueue
-> fast acknowledgement
-> idempotent worker
```

## Signature verification

Follow the provider's documented canonicalization and signature algorithm exactly. Verify against the raw representation when required; parsing and re-serializing first can invalidate or weaken verification.

Use constant-time comparison where applicable.

## Replay protection

Use provider timestamps/nonces/event IDs when available. Define an acceptable freshness window and reject stale signed requests when the provider protocol supports it.

## Idempotency

Persist processed event identifiers or otherwise make business operations idempotent. Assume providers can deliver the same event more than once.

## Queue handoff

Keep acknowledgement paths short. Perform expensive or failure-prone business logic asynchronously when possible.

## Secrets

Store webhook secrets in a secrets manager or protected configuration, rotate when supported, and avoid logging them or full sensitive payloads.

## Outbound webhooks

For callbacks sent by the application:

- sign payloads
- include timestamp/event ID
- support retries with backoff
- document delivery semantics
- protect destination management with authorization
- consider SSRF controls when users can configure callback URLs

## Additional resources

Read `references/replay-idempotency.md` for failure and retry patterns.

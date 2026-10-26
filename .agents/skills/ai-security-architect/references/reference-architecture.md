# Reference Architecture

## Request plane

```text
Client
-> CDN/WAF
-> Reverse Proxy/API Gateway
-> request ID
-> authentication
-> rate limiting
-> schema validation
-> authorization
-> application handler
```

## Agent plane

```text
Application
-> Agent Runtime
-> Model Router
-> structured action proposal
-> Tool Router
-> Policy Engine
-> Tool Gateway
-> action-specific service
-> result validation
-> audit
```

## Execution plane

```text
Tool Gateway
-> Execution Broker
-> Shell/Code Guard
-> Ephemeral Sandbox
-> Controlled Filesystem
-> Controlled Network Egress
-> Resource Limits
-> Destroy/Reset
```

## Event plane

```text
Provider
-> Webhook Endpoint
-> signature/timestamp verification
-> deduplication
-> enqueue
-> fast acknowledgement
-> worker
-> idempotent business operation
```

## Data plane

```text
Application/Workers
-> tenant-aware data access
-> relational database
-> object storage
-> vector search
-> cache
```

## Control plane

```text
Secrets Manager
Policy Configuration
Service Identity
Audit Logs
Metrics
Tracing
Alerts
```

## Design rules

1. Keep raw credentials outside model context.
2. Keep model output outside interpreters until validated and authorized.
3. Keep privileged execution outside the main application host when possible.
4. Treat external content as data, not instructions.
5. Scope every read/write by tenant/resource ownership.
6. Bound autonomous execution by time, cost, steps and side effects.
7. Make retries safe through idempotency or operation design.
8. Preserve enough audit context to reconstruct sensitive actions without logging secrets.

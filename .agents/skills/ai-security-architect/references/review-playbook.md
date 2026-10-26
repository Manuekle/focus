# AI Security Architecture Review Playbook

## 1. Discovery

Identify runtime, framework, hosting model, environments, network entry points, identities, persistent stores, model providers, tools, workers and external integrations.

Repository search targets commonly include:

- route/controller definitions
- middleware
- auth/session configuration
- authorization checks
- webhook handlers
- tool registries and schemas
- `exec`, `spawn`, shell wrappers, code runners
- browser automation
- file upload/parse paths
- external HTTP clients
- secrets/environment access
- model invocation wrappers
- vector search/embedding code
- queue producers/consumers
- logging and telemetry

## 2. Data-flow map

For each meaningful operation record:

`source -> validation -> identity -> authorization -> policy -> execution -> data touched -> external effect -> audit`

Pay extra attention to model-generated values crossing into privileged interpreters or external side effects.

## 3. Boundary review

For each trust boundary ask:

- What identity crosses it?
- How is that identity proven?
- What resource scope is enforced?
- Which untrusted fields cross it?
- What schema validation exists?
- Can secrets cross back in responses or logs?
- Is the next component allowed to trust the previous component?

## 4. AI action review

Enumerate tools/actions and classify:

- read/write
- internal/external side effect
- reversible/irreversible
- tenant-scoped/global
- unprivileged/privileged

Then verify per-action controls:

- strict schema
- authorization
- policy evaluation
- budget/rate limit
- timeout
- audit
- approval when necessary

## 5. Failure-path review

Review:

- retries
- duplicate delivery
- partial completion
- provider timeouts
- model/tool loops
- worker crashes
- queue poison messages
- expired credentials
- stale authorization decisions
- partial rollback

## 6. Production-readiness review

Verify:

- secret separation
- environment separation
- deployment identity
- rollback path
- backups/restore
- alerting
- tracing
- security event retention
- incident containment

## 7. Architecture sizing

### MVP
Prefer a modular monolith, managed database, managed cache/queue where necessary, and explicit tool/policy boundaries inside the application.

### Production
Add stronger service identity, durable queues/workflows, centralized policy where justified, comprehensive observability, key rotation and isolated execution.

### High-security
Consider stricter network segmentation, hardened sandboxes/microVMs, egress proxies, workload identity, mTLS, tamper-resistant audit trails and dedicated execution planes.

---
name: sandbox-execution-security
description: Review or design secure shell, code, browser, and arbitrary execution capabilities for AI agents or backend jobs. Use whenever model-generated or user-influenced code/commands can run, when an agent can access a terminal, when browser automation interacts with untrusted sites, or when execution must be isolated from the host, secrets, internal networks, and other tenants.
---

# Sandbox and Execution Security

Treat code and command execution as a separate execution plane.

## Required boundary

Prefer:

```text
Agent/Worker
-> Execution Broker
-> Policy Check
-> Command/Code Guard
-> Ephemeral Sandbox
-> Controlled Filesystem + Controlled Egress
-> Result Filter
```

Do not execute model-generated commands directly on the application host.

## Isolation

Use an isolation primitive appropriate to the threat model, such as hardened containers or stronger VM/microVM isolation for hostile arbitrary code.

Review:

- user/process isolation
- filesystem mounts
- host namespace exposure
- privileged mode/capabilities
- container/runtime socket exposure
- device access
- kernel/runtime assumptions
- cross-tenant reuse

## Filesystem

Prefer a minimal read-only base plus an isolated writable workspace. Do not expose host configuration, credential directories, deployment metadata or unrelated user files.

Canonicalize paths and enforce workspace roots server-side.

## Resource limits

Set bounded:

- wall-clock timeout
- CPU
- memory
- process count
- disk/workspace quota
- output size
- concurrency

Terminate and clean up reliably.

## Network egress

Default-deny or constrain egress when the product permits. Protect:

- localhost
- private address ranges
- cloud metadata services
- internal control planes
- service discovery endpoints
- credential/token endpoints

Route approved outbound traffic through an egress proxy/policy layer when stronger control is needed.

## Secrets

Do not inject broad application credentials into arbitrary execution environments. Prefer short-lived, scoped credentials only for explicit approved operations.

## Command guards

Do not rely solely on string deny-lists. Prefer capability-specific APIs over unrestricted shell commands. Where shell is required, combine authorization, sandboxing, restricted environment, path controls and resource/network isolation.

## Output handling

Bound stdout/stderr size. Treat execution output as untrusted before rendering, parsing or returning it to an agent.

## Lifecycle

Prefer ephemeral environments. Reset or destroy state between unrelated tenants/runs unless persistence is an explicit scoped feature.

## Additional resources

Read `references/sandbox-checklist.md` for detailed review questions.

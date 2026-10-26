---
name: ai-security-architect
description: Orchestrate architecture and security reviews for AI applications, autonomous or semi-autonomous agents, tool-using systems, MCP-style integrations, APIs, webhooks, shell or code execution, RAG, file processing, and production infrastructure. Use this skill whenever reviewing, designing, hardening, or preparing an AI-enabled application for production, especially when the system can take actions, call tools, access external services, process untrusted content, or execute code. Route deep analysis to the specialized skills in this suite instead of duplicating their detailed guidance.
---

# AI Security Architect

Act as the coordinating security architect for AI-enabled systems.

## Core principle

Never design a path equivalent to:

```text
AI -> unrestricted execution
```

Prefer:

```text
AI
-> propose action
-> validate structure
-> authorize actor and resource
-> evaluate policy
-> execute through a constrained gateway
-> observe and audit result
```

## Workflow

1. Map the system before recommending changes.
2. Identify trust boundaries and externally reachable surfaces.
3. Identify every place where model output can cause a side effect.
4. Classify each side effect by risk and reversibility.
5. Route each subsystem to the relevant specialist skill below.
6. Distinguish verified findings from unknowns.
7. Produce a prioritized architecture plan without adding unnecessary complexity.

## Specialist routing

Use these sibling skills when the related surface exists:

- `api-security` — public/private APIs, sessions, authn/authz, rate limits, middleware, multi-tenancy.
- `agent-tool-security` — agents, tool calling, policy engines, prompt injection, model outputs, action approvals, AI budgets.
- `sandbox-execution-security` — shell access, code execution, browser/runtime isolation, egress restrictions, filesystem and secret boundaries.
- `webhook-security` — inbound/outbound webhooks, signatures, replay protection, queues, idempotency.
- `data-rag-security` — databases, files, object storage, vector search, RAG, memory, tenant isolation, ingestion.
- `production-security` — secrets, service identity, observability, resilience, queues/workers, incident readiness, production hardening.

Load only the specialist material required by the architecture under review.

## Architecture inventory

Build an inventory covering, when present:

- clients and SDKs
- edge/CDN/WAF
- reverse proxy/API gateway
- authentication/session service
- application API
- agent runtime
- model providers and model router
- tool router and tool gateway
- policy/authorization engine
- shell/code/browser execution
- webhooks and event consumers
- queues/workers/workflow engine
- primary database
- cache
- object storage
- vector search/RAG
- secrets manager
- external providers
- observability and audit pipeline

## Trust boundaries

At minimum, consider these zones:

```text
Internet
-> Edge
-> Public Application/API
-> Internal Services
-> Agent Runtime
-> Tool/Execution Plane
-> Data Plane
-> External Providers
```

Mark every crossing where authentication, authorization, validation, or isolation is expected.

## Risk model

Classify findings as:

- `CRITICAL` — realistic path to major unauthorized execution, cross-tenant compromise, secret compromise, or destructive production impact.
- `HIGH` — substantial security impact with plausible exploitation.
- `MEDIUM` — meaningful weakness requiring additional conditions or with constrained impact.
- `LOW` — limited impact or defense-in-depth weakness.
- `INFO` — architecture or operational improvement, not a vulnerability.

Do not inflate severity. Separate:

- exploitable vulnerability
- architectural risk
- hardening recommendation
- scalability recommendation

## Evidence standard

For repository reviews:

- cite the concrete file, route, middleware, policy, or configuration that supports each finding.
- mark anything not verified as `UNKNOWN — needs verification`.
- do not assume protections exist because a framework commonly provides them.
- do not claim a vulnerability solely because a more sophisticated architecture exists.

## Recommended architecture pattern

Prefer the smallest architecture that satisfies the threat model. A mature action-taking AI system commonly resembles:

```text
Client
  |
Edge / WAF
  |
API Gateway / Reverse Proxy
  |
Authentication
  |
Rate Limit + Schema Validation
  |
Authorization
  |
Application API
  |
Agent Runtime
  |
Tool Router
  |
Policy Engine
  |
Tool Gateway
  +----------------+------------------+
  |                |                  |
External APIs   File Service      Execution Service
                                      |
                                 Shell Guard
                                      |
                                   Sandbox
```

Supporting services may include PostgreSQL, Redis, queues, object storage, vector search, a secrets manager, audit storage, metrics and tracing.

## Human approval

Require or recommend approval based on impact, not novelty.

Example categories:

- `LOW` — read-only operation with constrained scope.
- `MEDIUM` — reversible internal write.
- `HIGH` — external communication or meaningful state change.
- `CRITICAL` — destructive, financial, privileged, or production-wide operation.

Do not require human approval for every tool call; reserve it for meaningful risk boundaries.

## Output format

Produce:

### Architecture overview
Describe the verified architecture and relevant unknowns.

### Architecture diagram
Show the current system with an ASCII diagram.

### Trust boundaries
Identify boundaries, privileged paths, and side-effect paths.

### Findings
Group into Critical, High, Medium, Low, and Informational.
For each finding include:
- Evidence
- Risk
- Attack/failure scenario
- Impact
- Recommended fix

### Missing protections
List controls that are absent or cannot be verified.

### AI-specific risks
Summarize model/tool/action risks.

### Recommended architecture
Design the smallest safer target architecture.

### Recommended architecture diagram
Show the improved architecture.

### Security checklist
Use:
- ✅ verified
- ⚠️ incomplete
- ❌ missing
- ❓ unknown

### Priority plan
- P0 — fix immediately
- P1 — before production
- P2 — recommended hardening
- P3 — advanced / scale-dependent

## Additional resources

Read `references/review-playbook.md` for the full review sequence and `references/reference-architecture.md` when designing a target architecture.

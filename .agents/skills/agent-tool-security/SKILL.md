---
name: agent-tool-security
description: Review or design security boundaries for LLM agents and tool-calling systems. Use whenever a model can choose actions, call tools, invoke MCP-style capabilities, mutate data, send messages, browse external content, access credentials indirectly, or operate autonomously. Covers tool schemas, policy engines, prompt injection, action authorization, human approval, output validation, loop/cost budgets, and auditability.
---

# Agent and Tool Security

Treat the model as an untrusted decision component that can propose actions but must not define its own authority.

## Required action path

Prefer:

```text
model output
-> structured action
-> schema validation
-> actor/resource authorization
-> policy evaluation
-> approval when required
-> tool gateway
-> execution
-> result validation
-> audit
```

## Tool registry

For every tool document:

- purpose
- input schema
- output schema
- read/write behavior
- external side effects
- resource scope
- required capability
- risk category
- rate/budget limits
- timeout
- audit fields
- approval rule

Avoid general-purpose tools when narrower operations can satisfy the product requirement.

## Policy engine

Keep authorization outside the model. A policy decision should be able to return:

- `ALLOW`
- `DENY`
- `REQUIRE_APPROVAL`

Evaluate identity, tenant, tool, resource, environment, action risk and request context.

## Prompt injection

Treat these as untrusted content:

- websites
- emails
- retrieved documents
- uploaded files
- tool results
- third-party API responses
- RAG chunks

Do not allow external content to redefine tool permissions, system policy, secret access, approval rules or trust boundaries.

## Model output

Never send free-form model text directly into an interpreter, database query, shell, privileged API or destructive action. Require structured output and deterministic validation.

## Secrets

Do not place raw long-lived secrets in model context. Inject credentials in a downstream service after authorization and scope them to the minimum capability possible.

## Autonomous budgets

Bound agent execution where applicable:

- maximum steps
- maximum model tokens
- maximum wall-clock runtime
- maximum tool calls
- maximum calls per risky tool
- maximum spend
- maximum retries
- concurrency

Fail closed on budget exhaustion for side-effecting workflows.

## Human approval

Use approval where impact warrants it. Present the exact proposed action and important parameters; do not ask for vague blanket approval.

## Result handling

Validate tool results before reuse where structure matters. Prevent secrets and internal-only metadata from being reflected back into model-visible context without need.

## Audit

Capture enough information to reconstruct sensitive actions:

- actor
- agent/run
- tool
- normalized action
- resource
- policy decision
- approval state
- outcome
- request/trace ID
- duration/cost

Do not log raw credentials.

## Additional resources

Read `references/threat-model.md` for AI-specific threat patterns and `references/tool-contract.md` when defining new tools.

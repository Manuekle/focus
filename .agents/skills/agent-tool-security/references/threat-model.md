# AI Agent Threat Model

Review these threat classes when a model can observe untrusted content or take actions.

## Prompt injection
Untrusted content attempts to alter system policy, tool authority, approval rules, or goals.

## Excessive agency
The agent has broader tools, credentials, data scope, or persistence than the task requires.

## Tool abuse
A legitimate tool is invoked with malicious, over-broad, or unintended parameters.

## Cross-tenant action
Identity/resource checks fail to bind an action to the correct tenant.

## Secret exfiltration
Credentials or internal metadata enter model context, logs, tool output, or external requests.

## Loop amplification
Retries, planning loops, or tool recursion cause unbounded cost or side effects.

## Confused deputy
The agent uses its stronger authority to perform an action the requesting user is not allowed to perform.

## Data poisoning
Persistent memory or RAG data changes future behavior or retrieval in unsafe ways.

## Output-to-execution
Free-form model text crosses into a command, query, template, or privileged action without deterministic validation.

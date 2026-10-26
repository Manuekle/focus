# Secure Tool Contract

Document each tool with:

- **Name**
- **Purpose**
- **Inputs** — strict schema, constraints, canonicalization rules
- **Outputs** — expected schema and sensitivity
- **Side effects** — read, write, external communication, financial, destructive
- **Scope** — resources/tenants/environments it may access
- **Authorization** — deterministic permission requirements
- **Policy** — ALLOW / DENY / REQUIRE_APPROVAL conditions
- **Credentials** — downstream injection, scope, lifetime
- **Limits** — timeout, rate, cost, concurrency, retries
- **Network** — allowed destinations if relevant
- **Audit** — actor, action, resource, decision, result, correlation IDs
- **Failure mode** — fail-open or fail-closed expectations

Prefer narrow capability tools over generic shell/HTTP/database tools.

---
name: api-security
description: Review or design API security for AI and non-AI services, including authentication, authorization, RBAC/ABAC, sessions, API keys, CORS, CSRF, request validation, rate limiting, idempotency, multi-tenancy, and service-to-service authentication. Use whenever a system exposes HTTP/RPC endpoints, privileged routes, internal APIs, or user/workspace-scoped resources.
---

# API Security

Review the API as a security boundary, not just a transport layer.

## Workflow

1. Inventory all routes and RPC procedures.
2. Classify routes as public, authenticated, privileged, webhook, internal, or admin.
3. Identify the actor and resource for each route.
4. Verify resource-level authorization, not only authentication.
5. Review validation, rate limits, idempotency and side effects.
6. Trace sensitive operations through downstream services and data stores.

## Authentication

Verify:

- session/token validation
- expiration
- revocation
- refresh/rotation behavior
- audience/issuer when applicable
- secure cookie settings for browser sessions
- no authentication bypass on alternate methods/routes

Keep authentication distinct from authorization.

## Authorization

Check:

- resource ownership
- tenant/workspace boundaries
- role/capability checks
- server-side enforcement
- privileged/admin operations
- indirect object references
- cross-tenant lookup paths

Do not trust client-provided tenant IDs as proof of access.

Use RBAC for coarse capabilities and ABAC/resource checks when authority depends on tenant, resource ownership, environment, tool, action, or risk.

## Input and output

Apply strict schemas to body, query, path, headers where security-relevant, and structured tool/model payloads.

Canonicalize identifiers before authorization where inconsistent representation could bypass checks.

Avoid exposing internal exception details, stack traces, credentials or provider payloads.

## Rate limiting

Apply limits by the dimensions that match abuse risk:

- IP
- user
- API key
- tenant/workspace
- endpoint
- expensive operation
- model/tool where applicable

Do not rely on one global request-per-minute limit.

## Browser security

For cookie-authenticated applications review:

- CSRF protection
- SameSite policy
- Secure + HttpOnly
- CORS allowlist
- credentialed requests
- origin checks where needed
- CSP and relevant response headers

## API keys

Treat keys as identities with scope, ownership, expiration/revocation and audit history. Never treat possession of a broad shared key as equivalent to a user authorization decision.

## Idempotency

Use idempotency for operations that clients, workers, or providers may safely retry. Bind idempotency keys to appropriate actor/action scope and define retention behavior.

## Service-to-service

Do not assume an internal network is trusted. Authenticate meaningful service boundaries with scoped identities or signed credentials. Avoid one shared master service secret.

## Error handling

Return stable public error codes and correlation IDs. Keep sensitive diagnostics in protected logs.

## Additional resources

Read `references/checklist.md` for the API review checklist.

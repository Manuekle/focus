# Sandbox Review Checklist

## Host isolation
- no host root mount
- no sensitive host directories
- no privileged mode unless explicitly justified
- no Docker/container daemon socket mounted
- no unnecessary host namespaces/capabilities

## Filesystem
- read-only base where possible
- scoped writable workspace
- server-side path canonicalization
- disk/output limits
- cleanup between runs/tenants

## Runtime
- wall-clock timeout
- CPU limit
- memory limit
- process count limit
- concurrency control

## Network
- localhost/private ranges protected
- cloud metadata blocked
- internal control planes blocked
- egress allowlist/proxy when appropriate

## Secrets
- no broad inherited environment
- scoped, short-lived credentials only when required

## Output
- stdout/stderr bounded
- output treated as untrusted
- secrets/internal metadata filtered where appropriate

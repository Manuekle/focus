# RAG Threats

## Cross-tenant retrieval
Chunks from another tenant enter retrieval or model context.

## Retrieval authorization mismatch
A user cannot access a document directly but can retrieve its chunks through semantic search.

## Prompt injection
Retrieved content attempts to redefine system instructions, tool authority, or security policy.

## Knowledge poisoning
An attacker inserts or edits documents to influence later retrieval and model behavior.

## Sensitive embedding metadata
Vector records or metadata expose identifiers, access labels, or sensitive text.

## Ingestion parser risk
Complex file formats trigger parser vulnerabilities, resource exhaustion, archive bombs, or path problems.

## Cache leakage
Retrieval or response caches are keyed too broadly and cross tenant/user boundaries.

## Memory contamination
Untrusted or incorrect data becomes persistent memory and changes future agent behavior.

Mitigate by preserving ownership metadata, enforcing authorization before/during retrieval, isolating tenants, treating retrieved content as untrusted, and defining deletion/retention behavior.

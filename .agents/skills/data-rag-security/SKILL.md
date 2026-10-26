---
name: data-rag-security
description: Review or design data security for AI applications, including databases, file uploads, object storage, RAG pipelines, vector search, embeddings, persistent memory, tenant isolation, data retention, retrieval authorization, prompt injection through retrieved content, and poisoned knowledge sources. Use whenever an AI application stores or retrieves user data, ingests documents, performs semantic search, maintains persistent memory, or exposes files and generated artifacts.
---

# Data and RAG Security

Review both confidentiality boundaries and data-to-model boundaries.

## Data access

Verify least-privilege database identities, encrypted connections where appropriate, scoped queries, tenant isolation and safe migrations/backups.

Resource authorization must remain effective at the query/storage layer; do not trust client-supplied tenant identifiers.

## Uploads

Validate:

- declared and detected file type
- size
- file name/path handling
- archive nesting and decompression limits
- parser safety
- malware scanning when required by product/threat model
- storage location
- access policy

Do not serve untrusted uploads from a context that grants them application origin privileges without appropriate isolation.

## Object storage

Review bucket/container permissions, signed URL scope/expiry, object naming, tenant prefixes, metadata leakage and deletion behavior.

## RAG ingestion

Treat documents as untrusted data. Separate ingestion from trusted system instructions.

Review:

```text
upload/source
-> validation
-> parser
-> chunking
-> metadata/tenant labeling
-> embedding
-> index
```

Ensure tenant and authorization metadata survive the entire pipeline.

## Retrieval

Perform authorization filtering before or during retrieval; do not retrieve globally and filter only after sensitive content enters model context.

Review top-k, metadata filters, reranking and cache boundaries for cross-tenant leakage.

## Poisoning and prompt injection

Retrieved content may contain malicious instructions. Keep retrieved text in an explicitly untrusted context and prevent it from redefining policies or tool authority.

## Memory

Separate:

- conversation context
- persistent user/agent memory
- knowledge/RAG corpus

Define ownership, retention, deletion, sensitivity and tenant scope for each.

## Logs and analytics

Avoid logging sensitive raw prompts/documents by default. Redact secrets/tokens and define retention appropriate to the data class.

## Additional resources

Read `references/rag-threats.md` for RAG-specific threat patterns.

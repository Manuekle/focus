# Replay and Idempotency Patterns

A valid signature proves origin/integrity, not that an event is new.

## Inbound event flow

1. verify signature
2. verify freshness when protocol supports timestamps/nonces
3. validate schema
4. atomically claim/deduplicate event ID
5. enqueue or process
6. record outcome
7. acknowledge according to provider requirements

## Useful patterns

- unique event ID table with atomic insert
- queue message deduplication where semantics permit
- idempotency key tied to operation scope
- business-operation uniqueness constraints
- bounded replay window for timestamped signatures

Do not equate signature validity with uniqueness; a valid signed event can still be replayed.

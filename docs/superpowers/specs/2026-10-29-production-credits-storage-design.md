# Production credits and storage

## Goal

Protect the operator's Meta API budget while giving each signed-in user a useful trial: 300 Focus credits and at most three animation starts using the operator's key. After either allowance is exhausted, the user can continue AI work with their own Meta Model API key. Focus credits are application units, not Meta credits or a promise about actual provider billing.

## Scope and account policy

- Production AI calls require a signed-in account; anonymous browsing, uploads where already permitted, and local rendering remain separate from paid AI access. Existing anonymous work must not grant a fresh paid trial by signing in.
- Each existing or new account gets one initial grant of 300 credits, once. The allowance does not refresh automatically. Up to three operator-funded animation starts are allowed per account. Deleting an animation does not restore a start. Failed starts can be restored only when no provider request was billed or has an uncertain outcome.
- All operator-funded provider calls, including character generation, planning, chat, segmentation, video editing, animation generation and retries, must pass a common server-side credit gate. Merely confirming an animation's existing drawing budget cannot extend the account allowance. Cached results and local-only operations cost no credits.
- Provide a documented, configurable credit price schedule per model operation and estimated workload, conservative reservation before dispatch, and usage metrics to calibrate the schedule against actual provider prices. Do not represent 300 credits as a guaranteed number of complete animations: complexity, regeneration and other AI work affect consumption. Set a separate operator-wide spend/usage cap and retain the emergency switch and abuse controls.

## Ledger and execution

- Store grants, animation starts, reservations, settlements and refunds durably with transactional updates and idempotency keys. Concurrent requests and retries cannot overdraw a balance or count a start twice. Do not use the existing process-local lock or best-effort usage JSONL as the accounting source of truth.
- Bind each operation and background job to its authenticated owner and selected funding source. Authorize and reserve at the provider-call boundary, including retries, so alternate routes and long-running workers cannot bypass accounting. On a restart, reconcile unfinished reservations conservatively; do not automatically refund calls whose provider billing is unknown. Fail closed if accounting is unavailable.
- Keep the user's current free allowance and three-start count visible in the session/account UI; communicate the estimated cost before a paid operation. Disable or explain work that exceeds the balance, and offer connecting a personal key. Show a useful error if the provider rejects that key.

## Personal provider keys

- Store keys encrypted at rest with an application encryption secret supplied separately through production secret configuration. Never return the key after submission or include it in logs, URLs, client bundles, provider errors or usage records. Expose only whether a key is configured; support replacement and deletion. Document rotation and failure behavior.
- Resolve credentials per user and per job without mutating global process environment; never silently fall back to the operator key when a personal key is missing, rejected or removed. Ensure caches and provider file identifiers cannot cross credentials or user boundaries. Continue to apply infrastructure, rate and storage limits to personal-key work.

## Storage

- Preserve the Railway persistent volume requirement and global budget/free-space reserve; expose account storage usage and a configurable per-account quota (initial default 100 MB), enforced server-side for uploads and generated files. Account for concurrent writes and all owned copies, generated media, exports and temporary work; reject work safely when limits are reached.
- Make project and asset deletion accessible to the owner and remove associated files when no longer referenced. Retain saved projects until explicitly deleted; clean up unowned and temporary files according to the existing 24-hour policy. Do not delete saved user media automatically to reclaim space. Notify the user when their limit is reached and explain how to free space.
- Document volume provisioning, backups and restore testing. No assertion is made about the deployed Railway volume or its configuration without inspecting that environment.

## Migration and verification

- Introduce persistent accounting without resetting existing accounts or deleting existing media. Assign the initial grant once, including existing accounts; historical use is not retroactively billed. Preserve existing projects. If storage limits are already exceeded, prevent further growth while allowing users to delete or export their files.
- Verify concurrency, retries, crashes, idempotency, free-credit exhaustion, each paid route, credential isolation and revocation, storage accounting, deletion and access control. Test UI for clear balance, costs, storage and key errors. Run the relevant unit/integration checks and production deployment checks without spending provider credits by default.

## Deployment limits

The current Railway configuration targets one replica with a local volume; any multi-replica rollout requires shared durable accounting and coordinated storage quotas. Provider pricing, per-operation credit values and storage capacity require calibration before launch; application credits alone cannot guarantee an exact monetary ceiling. Set an independent provider-side limit where available and monitor actual usage.

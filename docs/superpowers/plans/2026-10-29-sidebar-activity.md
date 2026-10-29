# Sidebar activity implementation

1. Add a typed activity store with bounded recent history, state adapters and safe session restoration. Cover lifecycle transitions and dismissal with deterministic tests.
2. Add a root client provider that scopes activity to the current account and polls only tracked server jobs without replaying mutations.
3. Publish progress and results from the existing video, flipbook and character clients, including synchronous generation and exports.
4. Add the shared Activity footer using existing system components. Keep sidebar navigation independently scrollable above it.
5. Verify mocked browser lifecycle and cross-page navigation, long-library layout, keyboard dismissal and reduced motion; run typecheck and lint.

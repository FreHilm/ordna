# @frehilm/ordna-mock

Throwaway in-memory `TaskProvider` that exists only to verify Ordna's plugin loader works end-to-end. **Private — never published.**

Lives in the workspace so pnpm symlinks it into the root `node_modules/@frehilm/ordna-mock`. When `.ordna/config.yaml` says `provider: mock`, core's `loadProvider` resolves it via `await import("@frehilm/ordna-mock")` exactly like it would for a real published plugin.

## Smoke test recipe

From a fresh directory:

```bash
mkdir /tmp/ordna-mock-test && cd /tmp/ordna-mock-test
mkdir -p .ordna
cat > .ordna/config.yaml <<EOF
provider: mock
EOF

# Use the built CLI from the workspace
ORDNA=/path/to/TaskOps/packages/cli/dist/bin/ordna.js

node $ORDNA create "First task"     # → [ordna-mock] init() invoked
node $ORDNA create "Second task"
node $ORDNA list                     # → T-001 + T-002 listed
node $ORDNA show T-001
node $ORDNA move T-001 done
node $ORDNA list                     # → T-001 now in `done`
```

Watch for `[ordna-mock] init() invoked` on stderr — that's `provider.init()` from T-023's lifecycle wiring firing through the dynamic-import path.

For `dispose`, run the TUI or web server and quit:

```bash
node $ORDNA board    # press q to quit → [ordna-mock] dispose() invoked
node $ORDNA web      # Ctrl-C        → [ordna-mock] dispose() invoked
```

## State

The in-process data is a `Map<string, Task>` exactly as agreed. Cross-CLI persistence is achieved with a tiny JSON sidecar at `.ordna/mock-state.json` — without that, separate CLI processes wouldn't see each other's writes and the round-trip recipe above wouldn't work. The sidecar is mock-specific; nothing in real plugins should follow this pattern.

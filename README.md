# Ordna

> Project management as plain files. Your AI agent already knows how to read them.

Just markdown. The Kanban is the directory. Your editor and your agent open the same files.

```
tasks/
  T-001.md      # ← one file per task
  T-002.md
  T-003.md
.ordna/
  config.yaml   # ← optional
```

That's the whole schema. No database, no service account, no API key, no MCP. The CLI, TUI, and web UI all derive the board from these files.

## Why

External project-management tools sit outside your code. Tasks live in a database you don't own, under an account you can't fully back up, with access that breaks when the company folds or the plan changes. And they're invisible to AI agents unless you bolt on an integration that may or may not survive the next vendor pivot.

Ordna puts tasks next to the code. One markdown file per task in `tasks/`, period. The Kanban is computed from those files. Git handles branching, merging, blame, history, and backups. Your agent opens `tasks/T-001.md` the same way it opens any other file in your repo, and writes back the same way too — no API key, no integration to maintain.

Built for the moment when half your collaborators are agents.

## What you get

- **Simple by construction.** `cat tasks/T-001.md` is the API. If your agent can read a file, your agent can read your tasks.
- **Branches are first-class.** A feature branch can have its own task edits. PRs review them like any other diff — title, description, acceptance criteria, all of it.
- **Agent-native handoff.** When the user clicks "send to agent" (or hits `g` in the TUI), Ordna POSTs the full task as JSON to your IDE over plain HTTP. That's the entire integration surface.
- **Three surfaces, one source of truth.** A polished TUI, a browser Kanban, or just the library. Pick whichever — they all read the same markdown.
- **Backlog.md compatible.** Open existing [Backlog.md](https://github.com/MrLesk/Backlog.md) repos out of the box.

## Quick start

```bash
pnpm install
pnpm -r build
alias ordna="node $PWD/packages/cli/dist/bin/ordna.js"

cd your-project
ordna init                                       # creates tasks/ and .ordna/config.yaml
ordna create "Implement payment flow" -p high
ordna create "Write tests" -d T-001              # depends on T-001
ordna                                            # opens the TUI
ordna web                                        # opens the browser Kanban
```

You now have:

```
tasks/T-001.md
tasks/T-002.md
.ordna/config.yaml
```

Each is a regular markdown file. Edit them in `$EDITOR` and the board updates live.

## Packages

| Package | What it is | Install |
|---|---|---|
| [`@frehilm/ordna-core`](packages/core/README.md) | The data layer — pure TypeScript, no UI | `pnpm add @frehilm/ordna-core` |
| [`@frehilm/ordna-cli`](packages/cli/README.md)   | The `ordna` binary + Ink-based Kanban TUI | `npm i -g @frehilm/ordna-cli` |
| [`@frehilm/ordna-web`](packages/web/README.md)   | Hono server + React SPA — the browser Kanban | `pnpm add @frehilm/ordna-web` |

The two UI packages **re-export the full core API**. So if you want both data access and a UI, you only ever install one Ordna package.

## Agent skill (AGENTS.md)

Ordna ships a vendor-neutral [`AGENTS.md`](packages/cli/templates/AGENTS.md)
describing the task file format, `.ordna/config.yaml`, and the `ordna` CLI.
Drop it into any project and most coding agents (Claude, Cursor, Copilot,
Codex, …) will pick it up automatically.

Two ways to install:

```bash
# 1) Via the CLI (uses the bundled template)
ordna skill install                              # writes ./AGENTS.md
ordna skill install --out docs/AGENTS.md         # custom path
ordna skill install --force                      # overwrite existing

# 2) Direct fetch — give the agent a URL, no Ordna install required
curl -fsSL https://raw.githubusercontent.com/FreHilm/ordna/main/packages/cli/templates/AGENTS.md \
  -o AGENTS.md

# Or via the CLI's --from flag
ordna skill install --from https://raw.githubusercontent.com/FreHilm/ordna/main/packages/cli/templates/AGENTS.md
```

## Host integration (IDE / Electron / agent runners)

Ordna is built to be embedded. Both UIs detect a single environment variable (or programmatic option) and surface a button that POSTs the full task to your host process — your IDE then runs an agent on it.

### Embedding

| You want                  | Install                                          | Single import covers                              |
|---------------------------|--------------------------------------------------|---------------------------------------------------|
| Just the data layer       | `@frehilm/ordna-core`                            | parser, store, watcher, git, types                |
| Embed the web kanban      | `@frehilm/ordna-web`                             | core API + `runWeb()`                             |
| Embed the TUI             | `@frehilm/ordna-cli`                             | core API + `runBoard()`                           |
| Both UIs                  | `@frehilm/ordna-web` + `@frehilm/ordna-cli`      | both UIs; pnpm dedupes the shared core            |
| Standalone CLI binary     | `npm i -g @frehilm/ordna-cli`                    | `ordna` on `$PATH`                                |

```ts
// Electron main process
import { runWeb, listTasks, watchTasks } from "@frehilm/ordna-web";
import { app, BrowserWindow } from "electron";

const ide = await runWeb({
  cwd: workspaceRoot,
  port: 0,
  openBrowser: false,
  agentHook: {
    url: `http://127.0.0.1:${ideHookPort}/agent`,
    label: "Claude",
    headers: { "X-IDE-Token": ideToken },
  },
});

new BrowserWindow().loadURL(`http://127.0.0.1:${ide.port}`);
app.on("before-quit", () => ide.close());
```

For a TUI pane, spawn the `ordna` binary inside `node-pty` and pipe to `xterm.js`. Or import `runBoard` from `@frehilm/ordna-cli` for an in-process launch.

### Agent hook

When the host is configured, both UIs show a button (web cards + modal head, TUI shortcut `g`) that POSTs to your URL:

```json
{
  "action": "agent",
  "task": { /* full Task — see core README */ },
  "context": { "tasksDir": "tasks", "cwd": "/path/to/repo", "schema": "ordna" }
}
```

The hook is **strictly opt-in**. With no env var and no programmatic option, the button doesn't appear and standalone behavior is unchanged.

For terminal users, set env vars:

```bash
export ORDNA_AGENT_HOOK_URL=http://127.0.0.1:9999/agent
export ORDNA_AGENT_HOOK_LABEL=Claude                         # default "Agent"
export ORDNA_AGENT_HOOK_HEADERS='{"X-Agent-Token":"..."}'
```

For embedded hosts, pass `agentHook` to `runWeb` / `runBoard`. The programmatic option wins; pass `agentHook: null` to disable explicitly.

Minimal listener (Node):

```ts
http.createServer((req, res) => {
  if (req.url === "/agent" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const { task, context } = JSON.parse(body);
      runAgent(task, context);   // your code
      res.writeHead(202).end();
    });
  }
}).listen(9999, "127.0.0.1");
```

## Architecture

```
Filesystem (Git repo)
    ↓
@frehilm/ordna-core      pure library — parser, writer, store, watcher, ids, git, config
    ↓                ↙           ↘
@frehilm/ordna-cli            @frehilm/ordna-web
  (CLI + TUI)                (Hono server + React SPA)
```

- **core** has zero I/O frameworks and zero globals.
- **cli** uses commander + Ink. The TUI is a React tree rendered to the terminal.
- **web** is a Hono server serving a Vite + React SPA; drag-and-drop via `@dnd-kit`; live updates via WebSocket sourced from the core watcher.

## Principles

- **Files are the API.** If it can't be expressed in a markdown file, it doesn't belong.
- **No hidden state.** Everything you see comes from a file on disk.
- **Git is the source of truth.** Branches, merges, and blame are how you reason about task history.
- **Commits are explicit.** Ordna never auto-commits. Use `ordna commit` or plain `git commit`.
- **Zero-config defaults are load-bearing.** With no config file, behavior matches the docs. Config only expands.
- **Host integrations are opt-in.** Without env vars or options, there's nothing to see — Ordna is fully standalone.

## Development

```bash
pnpm install
pnpm -r build          # build all packages
pnpm -r test           # run all tests (core 20 · cli 8 · web 9)
pnpm --filter @frehilm/ordna-web dev:server    # server in watch mode
pnpm --filter @frehilm/ordna-web dev:client    # vite dev server on :5173
```

## License

[MIT](LICENSE) © FreHilm

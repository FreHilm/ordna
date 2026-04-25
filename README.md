# Ordna

Git-native project management. Tasks are markdown files. The board is derived from the filesystem. Humans and AI agents operate on the same files.

- **No server required.** Ordna works entirely against your repo.
- **No hidden state.** Every task is a file you can read, edit, diff, and review.
- **CLI, TUI, and Web Kanban** — all backed by the same core library.
- **Backlog.md compatible.** Opens existing Backlog.md repos.
- **One-package embedding.** `@frehilm/ordna-web` and `@frehilm/ordna-cli` both re-export the full core API — install just the surface you want.

## Why

External project-management tools sit outside your code. Tasks live in a database you don't own, under an account you can't fully back up, with access that breaks when the company folds or the plan changes. They're also invisible to AI agents unless you wire up an MCP or a scraper.

Ordna puts tasks next to the code. Every task is a markdown file in `tasks/`. The Kanban is computed from those files. Git handles branching, merging, blame, history, and backups. Agents read and write the same files you do, no API key required.

## Install

```bash
# Requires Node 20+ and pnpm
pnpm install
pnpm -r build
```

The `ordna` binary lives at `packages/cli/dist/bin/ordna.js`. Link it into your path:

```bash
pnpm --filter @frehilm/ordna-cli link --global
# or
alias ordna="node $PWD/packages/cli/dist/bin/ordna.js"
```

## Quick start

```bash
cd your-project
ordna init                                 # creates .ordna/config.yaml and tasks/
ordna create "Implement payment flow" -p high -t payments
ordna create "Write tests" -d T-001
ordna list
ordna move T-001 doing
ordna                                      # launches the TUI
ordna web                                  # opens the browser Kanban
```

## Task files

One file per task, lives in `tasks/`. The filename is the ID.

```markdown
---
id: T-001
title: Implement payment flow
status: todo
assignee: null
priority: high
tags: [payments]
depends_on: []
created_at: 2026-04-18
updated_at: 2026-04-18
---

## Goal
Ship a working payment flow.

## Acceptance Criteria
- [ ] Card works
- [ ] Apple Pay works

## Notes
Careful with PCI.

## Progress
```

Acceptance criteria are plain markdown checkboxes. The files are the API — edit them in your editor and everything downstream (TUI, Web, CLI) picks up the change.

### Dependencies

`depends_on` is enforced: moving a task to the terminal status (`done` by default) while any dependency is unfinished is rejected with a clear error. Other status transitions are free.

### Archiving

`archived` is a reserved status. Any task moved to `archived` disappears from the active board and the `All tasks` view. To see them, open the **Archived** row in the sidebar (TUI and Web). You don't need to add `archived` to `statuses` in your config — it's always available.

In the TUI: press `x` on a selected task to archive it.
In the Web: open the task modal and pick `archived` from the Status dropdown.

## CLI

```
ordna                     Launch the TUI (default)
ordna board               Launch the TUI
ordna init                Create .ordna/config.yaml and tasks/
ordna list [-s status]    List tasks, optionally filtered
ordna show <id>           Print a task
ordna create <title...>   Create a task
  -p, --priority <level>  high | medium | low
  -t, --tag <tag...>      one or more tags
  -d, --depends-on <id..> one or more dependency IDs
  -a, --assignee <name>
  -s, --status <status>
ordna move <id> <status>  Change status (depends_on gate on `done`)
ordna assign <id> [name]  Omit name to unassign
ordna commit [-m msg]     Stage tasks/ and git commit
ordna web [-p port]       Start the local web Kanban
```

## TUI

Launch with `ordna` or `ordna board`. A three-pane layout: topbar · filter sidebar · board (columns) · subbar · footer hints.

| Key            | Action                                   |
|----------------|------------------------------------------|
| `Tab`          | Toggle focus between sidebar and board   |
| `← → / h l`    | Switch column (board) / unused (sidebar) |
| `↑ ↓ / j k`    | Select task / sidebar row                |
| `Enter`        | Open task detail popup / apply filter    |
| `Space`        | Pick up task; then `← →` to move columns |
| `c`            | Create a new task                        |
| `m`            | Move task via status picker              |
| `a`            | Set assignee                             |
| `e`            | Edit the task file in `$EDITOR`          |
| `x`            | Archive selected task                    |
| `g`            | Send task to agent hook (only if enabled)|
| `/`            | Search                                   |
| `Esc`          | Clear search / drop / close              |
| `q`            | Quit                                     |

**Sidebar**: `Views` (All / each configured status / Archived) · `Priority` (high/medium/low) · `Tags` (top 8 by usage). Counts are live. Selected filter scopes the board and the subbar title.

**Columns**:
- Double-line border, colored dot for the status, title + count.
- Single-line rows: `› T-001  !h  Title   #tag @user  ███░░ 3/5  ↪1` — priority letter, colored tag chips, assignee, acceptance-criteria progress bar, depends-on count.
- Scrolling: when a column overflows, `↑ N more` and `↓ N more` indicators appear. Selection auto-scrolls to stay visible. Moving a task scrolls the target column to reveal it.
- Columns fill the available width evenly — except the **Archived** view, where the lane keeps a single-column width.

**Popup**: Enter on a task opens a centered modal with the full body. `e` opens in `$EDITOR`. `Esc`/`q` closes.

The TUI runs in the alternate screen buffer (no scrollback pollution) and reloads automatically when task files change on disk.

## Web

```bash
ordna web
```

Starts a local server (default port `7420`) and opens `http://127.0.0.1:7420` in your browser.

- Topbar with brand, tasks-dir crumb, search, theme toggle, shortcuts, and `+ New task`.
- Filter sidebar: Views (All + each status + Archived) · Priority · Tags.
- Subbar showing the current view and visible/total counts.
- Columns per configured status, drag-and-drop with a rotated floating overlay and optimistic updates (rolls back on server rejection).
- Cards: id, priority chip, title, tag chips (hashed colors), bottom meta (assignee + AC progress). Hover reveals Edit / Delete action buttons.
- Click a card → **view-mode modal**. Big title, status/priority/assignee/tags chips, acceptance-criteria checklist (click a box to toggle and auto-save), section bodies, side panel. Press **Edit** to switch to edit mode: title, status, priority, assignee, tags (chip input), depends_on (chip input), acceptance list UI, section textareas. Save / Cancel.
- Light / dark theme toggle (persisted).
- Keyboard shortcuts:

  | Key   | Action                     |
  |-------|----------------------------|
  | `⌘/Ctrl + K` | Command palette (search tasks + actions) |
  | `n`   | New task                   |
  | `/`   | Focus search               |
  | `t`   | Toggle theme               |
  | `?`   | Toggle shortcut cheatsheet |
  | `Esc` | Close modal / overlay      |

Everything is over WebSocket — changes from the TUI, CLI, editor, or another tab show up instantly. The web process is local; nothing leaves the machine.

## Configuration

`.ordna/config.yaml` is optional. With no config, Ordna behaves exactly as above.

```yaml
tasksDir: tasks            # where task files live
schema: ordna              # ordna | backlog
statuses: [todo, doing, done]
idPrefix: T                # custom prefix, e.g. BUG, EPIC
zeroPaddedIds: 3           # width of the numeric part (0 = no padding)
webPort: 7420
```

Columns in the board map 1:1 to `statuses`. The last entry is the "done" status for dependency gating. `archived` is reserved and always available; it doesn't appear in `statuses`.

## Backlog.md compatibility

Ordna reads [Backlog.md](https://github.com/MrLesk/Backlog.md) repos out of the box. The parser normalizes both field sets:

| Ordna         | Backlog.md    |
|---------------|---------------|
| `tags`        | `labels`      |
| `depends_on`  | `dependencies`|
| `created_at`  | `createdDate` |
| `updated_at`  | `updatedDate` |
| `assignee: "x"` or `null` | `assignee: ["x"]` or `[]` |

To open a Backlog repo, point Ordna at its directory and set:

```yaml
tasksDir: backlog
schema: backlog
```

In `schema: backlog` mode, Ordna writes Backlog-style filenames (`task-1 - title.md`) and field names. Tasks round-trip cleanly between tools.

## Embedding in a host (IDE / Electron / scripts)

Each package is independently usable, and the two UI packages re-export the entire `@frehilm/ordna-core` API. So whichever surface you embed, you only ever install one Ordna package — there is no transitive `core` dep to wire up.

| You want                  | Install                          | Single import covers                              |
|---------------------------|----------------------------------|---------------------------------------------------|
| Just the data layer       | `@frehilm/ordna-core`                    | parser, store, watcher, git, types                |
| Embed the web kanban      | `@frehilm/ordna-web`                     | core API + `runWeb()`                             |
| Embed the TUI             | `@frehilm/ordna-cli`                     | core API + `runBoard()`                           |
| Both UIs                  | `@frehilm/ordna-web` + `@frehilm/ordna-cli`      | both UIs; pnpm dedupes the shared core            |
| Standalone CLI binary     | `npm i -g @frehilm/ordna-cli`            | `ordna` on `$PATH`                                |

### Minimal Electron embed

```ts
// main process
import { runWeb, listTasks, watchTasks, ARCHIVED_STATUS } from "@frehilm/ordna-web";
import { app, BrowserWindow } from "electron";

const ide = await runWeb({
  cwd: workspaceRoot,
  port: 0,                              // OS-assigned
  openBrowser: false,
  agentHook: {                          // programmatic, no env var needed
    url: `http://127.0.0.1:${ideHookPort}/agent`,
    label: "Claude",
    headers: { "X-IDE-Token": ideToken },
  },
});

new BrowserWindow().loadURL(`http://127.0.0.1:${ide.port}`);
app.on("before-quit", () => ide.close());

// In a side panel: live task list — same API, no separate @frehilm/ordna-core install
const tasks = await listTasks(ide.context);
const stop = watchTasks(ide.context, (event) => {
  // event: { type: "added" | "changed" | "removed", task | id }
});
```

For the **TUI in a terminal pane**, the simplest path is to spawn the `ordna` binary inside `node-pty` and pipe to `xterm.js` — the TUI gets a real TTY for raw-mode input. If you'd rather keep it in-process, `runBoard()` is also exported from `@frehilm/ordna-cli`:

```ts
import { runBoard } from "@frehilm/ordna-cli";

await runBoard({
  agentHook: { url, label, headers },   // same shape as runWeb's
});
```

### Agent hook

The agent hook is **strictly opt-in** — nothing appears unless you wire it up, so the standalone CLI / web behavior is unchanged.

For terminal users, set env vars:

```bash
export ORDNA_AGENT_HOOK_URL=http://127.0.0.1:9999/agent
export ORDNA_AGENT_HOOK_LABEL=Claude                      # optional, default "Agent"
export ORDNA_AGENT_HOOK_HEADERS='{"X-Agent-Token":"…"}'   # optional JSON headers
```

For embedded hosts, pass `agentHook` directly to `runWeb` / `runBoard` (shown above). The programmatic option **wins** over env vars; pass `agentHook: null` to explicitly disable the hook even when env vars are set.

When enabled:

- **Web**: each card hovers an amber `Claude` (or whatever you named it) action button; the task modal shows the same in its header.
- **TUI**: press `g` on any selected task. The footer gains a `g claude` hint only when the hook is enabled.

Both surfaces POST the same JSON to your URL:

```json
{
  "action": "agent",
  "task": { /* full WireTask — id, title, status, assignee, priority, tags, depends_on, sections, created_at, updated_at, filePath, … */ },
  "context": { "tasksDir": "tasks", "cwd": "/path/to/repo", "schema": "ordna" }
}
```

The hook URL is never exposed to the browser — the web SPA calls `POST /api/tasks/:id/agent`, the server forwards on its behalf. Custom headers stay server-side too.

A 2xx response means "accepted" — the button toasts `Sent T-001 to Claude`. Anything else surfaces the response body as an error toast.

Minimal host listener (Node):

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
@frehilm/ordna-core      library — parser, writer, store, watcher, ids, git, config
    ↓         ↙         ↘
@frehilm/ordna-cli        @frehilm/ordna-web
  (CLI + TUI)    (Hono server + React SPA)
```

- **core** is pure: no I/O frameworks, no globals. Importable from Electron, a script, a server, or an agent.
- **cli** bundles commander and Ink. The TUI is a React tree rendered to the terminal.
- **web** is a Hono server serving a Vite + React SPA; drag-and-drop via `@dnd-kit`; live updates via WebSocket sourced from the core watcher.

## Principles

- **Files are the API.** If it can't be expressed in a markdown file, it doesn't belong in Ordna.
- **No hidden state.** Everything a user sees must come from a file on disk.
- **Git is the source of truth.** Branches, merges, and blame are how you reason about task history.
- **Commits are explicit.** Ordna never auto-commits. Use `ordna commit` or plain `git commit`.
- **Zero-config defaults are load-bearing.** With no config file, Ordna behaves as documented. Config only expands capability.
- **Host integrations are opt-in.** If the env vars aren't set, there's nothing to see — Ordna is fully standalone.

## Development

```bash
pnpm install
pnpm -r build          # build all packages
pnpm -r test           # run all tests (core: 20 · cli: 8 · web: 8)
pnpm --filter @frehilm/ordna-web dev:server    # run server in watch mode
pnpm --filter @frehilm/ordna-web dev:client    # run vite dev server on :5173
```

## Package layout

```
packages/
  core/   @frehilm/ordna-core  — pure library
  cli/    @frehilm/ordna-cli   — `ordna` binary + Ink TUI
  web/    @frehilm/ordna-web   — Hono server + React SPA
```

## License

TBD.

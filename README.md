# Ordna

Git-native project management. Tasks are markdown files. The board is derived from the filesystem. Humans and AI agents operate on the same files.

- **No server required.** Ordna works entirely against your repo.
- **No hidden state.** Every task is a file you can read, edit, diff, and review.
- **CLI, TUI, and Web Kanban** — all backed by the same core library.
- **Backlog.md compatible.** Opens existing Backlog.md repos.

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
pnpm --filter @ordna/cli link --global
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

Launch with `ordna` or `ordna board`. Keyboard:

| Key            | Action                     |
|----------------|----------------------------|
| ← → / h l      | Switch column              |
| ↑ ↓ / j k      | Select task in column      |
| Enter          | Open task detail           |
| c              | Create a new task          |
| m              | Move task to another column|
| a              | Set assignee               |
| e              | Edit in `$EDITOR`          |
| /              | Search                     |
| Esc            | Clear search               |
| q              | Quit                       |

The TUI reloads automatically when task files change on disk — whether from the CLI, the web, another agent, or your editor.

## Web

```bash
ordna web
```

Starts a local server (default port `7420`) and opens `http://127.0.0.1:7420` in your browser.

- Columns per configured status
- Drag-and-drop between columns (optimistic updates, rolls back on server rejection)
- Live updates over WebSocket
- Search by id, title, or tag
- Dark theme

The web process is local. Nothing leaves the machine.

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

Columns in the board map 1:1 to `statuses`. The last entry is the "done" status for dependency gating.

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

## Architecture

```
Filesystem (Git repo)
    ↓
@ordna/core      library — parser, writer, store, watcher, ids, git, config
    ↓         ↙         ↘
@ordna/cli        @ordna/web
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

## Development

```bash
pnpm install
pnpm -r build          # build all packages
pnpm -r test           # run all tests
pnpm --filter @ordna/web dev:server    # run server in watch mode
pnpm --filter @ordna/web dev:client    # run vite dev server on :5173
```

## Package layout

```
packages/
  core/   @ordna/core  — pure library
  cli/    @ordna/cli   — `ordna` binary + Ink TUI
  web/    @ordna/web   — Hono server + React SPA
```

## License

TBD.

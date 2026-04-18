# Ordna — Build Plan

Companion to `PRD.md`. Captures the design decisions and implementation sequence agreed on 2026-04-18.

## 1. Design Decisions

### Tech stack
- **Language:** TypeScript end-to-end (bundles cleanly with Electron IDE; runs standalone via compiled binary).
- **Package manager / workspace:** pnpm workspaces.
- **Test / lint:** vitest, biome.
- **TUI:** Ink (React for CLI).
- **Web server:** Hono (tiny, fast, runs anywhere).
- **Web SPA:** Vite + React + dnd-kit for drag-and-drop.
- **File watching:** chokidar.
- **Web ↔ SPA live updates:** WebSocket.

### Monorepo layout
```
ordna/
  packages/
    core/      # pure library: parser, writer, store, ids, watcher, git, config
    cli/       # `ordna` binary; hosts Ink TUI and CLI commands
    web/       # Hono server + Vite/React SPA (served by `ordna web`)
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  biome.json
```
TUI lives inside `cli` — they ship together. Split later only if it grows.

### Core library API
Exported from `@ordna/core` as pure functions returning plain data:
```ts
listTasks(opts?) → Task[]
getTask(id) → Task | null
createTask(input) → Task
updateTask(id, patch) → Task
moveTask(id, status) → Task     // enforces depends_on gate
deleteTask(id) → void
watchTasks(cb) → unsubscribe
commit(message?) → void         // manual git commit of tasksDir
```
CLI, TUI, Web, and the Electron IDE all import directly. An HTTP API can wrap these later if needed.

### Task schema (Ordna default)
File: `tasks/T-001.md`
```yaml
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
...

## Acceptance Criteria
- [ ] ...

## Notes
...

## Progress
...
```

### Backlog.md compatibility — Option C (dual-schema parser)
- Parser accepts **both** field name sets and normalizes internally:
  - `tags` ↔ `labels`
  - `depends_on` ↔ `dependencies`
  - `created_at` ↔ `createdDate`
  - `updated_at` ↔ `updatedDate`
  - `assignee: string | null` ↔ `assignee: string[]` (writer normalizes)
- Writer serializes in the schema chosen by `.ordna/config.yaml`:
  - `schema: ordna` (default) → PRD field names, body `## Goal / ## Acceptance Criteria / ## Notes / ## Progress`, files named `T-001.md`.
  - `schema: backlog` → Backlog field names, body `## Description / ## Acceptance Criteria / ## Implementation Plan / ## Implementation Notes / ## Final Summary`, files named `task-1 - Title.md`.
- Statuses are configurable strings (default `[todo, doing, done]`). Backlog repos tend to use `[To Do, In Progress, Done]`; both just work.
- A Backlog repo opens and round-trips as long as `schema: backlog` is set.

### Task IDs
- Default format: `T-001` — prefix `T`, zero-padded to 3 digits.
- Configurable prefix (one per project) via `idPrefix`.
- Configurable padding via `zeroPaddedIds`.
- Auto-incremented by scanning existing task files for the current max.
- Merge conflicts between branches that both claimed the same ID are resolved by the developer — Ordna does not try to auto-resolve.

### Status & board
- Board is **derived** from the set of task files. No central `kanban.md`.
- Statuses = columns, 1:1. No swimlanes.
- Moving a task to `done` while `depends_on` has unfinished items returns an error.

### Git
- No auto-commit. User commits explicitly via `ordna commit` or plain `git commit`.

### Acceptance criteria
- Stored as plain markdown checkboxes (`- [ ]`) in the body. Text is the source of truth.
- Parser exposes a structured view to the UI layer; UI never bypasses the file.

### Config file (all keys optional)
`.ordna/config.yaml`:
```yaml
tasksDir: tasks
schema: ordna            # or "backlog"
statuses: [todo, doing, done]
idPrefix: T
zeroPaddedIds: 3
webPort: 7420
```
**Invariant:** with no config file present, Ordna behaves exactly as the PRD specifies. Config only expands.

### CLI surface
```
ordna                     # launches TUI (same as `ordna board`)
ordna board               # TUI
ordna list [--status …]   # list tasks
ordna show T-001          # print a task
ordna create "title"      # new task
ordna move T-001 doing    # change status (enforces deps)
ordna assign T-001 fredrik
ordna commit [-m msg]     # stage tasksDir and git commit
ordna web                 # start local server + open browser
ordna init                # create .ordna/config.yaml + tasks/ if missing
```

### TUI (Ink)
- Columns: one per configured status. Default three: TODO | DOING | DONE.
- Dark theme, polished layout.
- Keys per PRD: arrows to navigate, Enter open, `m` move, `a` assign, `e` edit in $EDITOR, `c` create, `/` search, `q` quit.

### Web
- `ordna web` starts Hono on `webPort` (default 7420) and opens the browser.
- REST for CRUD, WebSocket for watcher-driven live updates.
- SPA: columns, drag-and-drop (dnd-kit), dark mode, fast first paint (plain Vite build, no RSC).
- DnD writes back to the file immediately via core; watcher echoes to other clients.

## 2. Milestones

### M1 — `packages/core` (library, no UI)
- [ ] pnpm workspace bootstrap, tsconfig base, vitest, biome
- [ ] `config.ts` — load `.ordna/config.yaml`, merge with defaults, typed
- [ ] `schema.ts` — canonical `Task` type + Zod schema; field-alias table for Backlog compat
- [ ] `parser.ts` — YAML frontmatter + body section detection + AC checkbox extraction, round-trip safe
- [ ] `writer.ts` — serialize `Task` back to markdown in active schema
- [ ] `store.ts` — list/get/create/update/move/delete; `depends_on` gate on move-to-done
- [ ] `ids.ts` — scan existing files, compute next ID with configured prefix + padding
- [ ] `watcher.ts` — chokidar wrapper, emits `TaskEvent` stream
- [ ] `git.ts` — thin commit wrapper; no auto-commit
- [ ] Test fixtures: a real Ordna repo + a real Backlog.md repo; round-trip tests for both

### M2 — `packages/cli` (CLI + TUI)
- [ ] CLI command wiring (commander or citty)
- [ ] All commands listed under "CLI surface"
- [ ] Ink TUI: columns, keyboard nav per PRD, search, edit in $EDITOR
- [ ] Dark theme, polished layout

### M3 — `packages/web`
- [ ] Hono server behind `ordna web`: REST CRUD + WebSocket events
- [ ] Vite + React SPA: columns, dnd-kit, dark mode, fast load
- [ ] Writes flow core → file → watcher → broadcast → re-render

### M4 — polish
- [ ] Backlog.md importer smoke test against the real repo
- [ ] Bundling for standalone use (Bun compile or `pkg`) — Mac/Linux/Windows
- [ ] `README.md`, examples, `ordna init`

## 3. Open questions deferred to implementation
- Exact CLI framework (commander vs citty vs cac) — pick during M2.
- Exact SPA styling approach (Tailwind vs CSS modules) — pick during M3.
- Whether to expose the web API as a public HTTP contract for the Electron IDE or to keep it internal — revisit after M3.

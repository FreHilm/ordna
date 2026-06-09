# @frehilm/ordna-core

The data layer for [Ordna](../../README.md). Pure TypeScript — no I/O frameworks, no React, no UI. Importable from a CLI tool, a web server, an Electron main process, or an agent script.

This package is what `@frehilm/ordna-cli` and `@frehilm/ordna-web` are built on. If you only want to read and write tasks programmatically, install just this.

## Install

```bash
pnpm add @frehilm/ordna-core
# or:    npm i @frehilm/ordna-core
```

## Use

```ts
import {
  createContext,
  listTasks,
  createTask,
  moveTask,
  watchTasks,
  ARCHIVED_STATUS,
  type Task,
} from "@frehilm/ordna-core";

const ctx = createContext("/path/to/repo");

const tasks = await listTasks(ctx);
const created = await createTask({ title: "Implement payment flow", priority: "high" }, ctx);
await moveTask(created.id, "doing", ctx);

const stop = watchTasks(ctx, (event) => {
  // event.type: "added" | "changed" | "removed"
});
stop();
```

## API

```ts
createContext(cwd?: string): StoreContext

listTasks(ctx, opts?: { status?, assignee?, tag? }): Promise<Task[]>
getTask(id, ctx): Promise<Task | null>
createTask(input: TaskCreateInput, ctx): Promise<Task>
updateTask(id, patch: TaskUpdateInput, ctx): Promise<Task>
moveTask(id, status, ctx): Promise<Task>     // depends_on gate on terminal status
deleteTask(id, ctx): Promise<void>

watchTasks(ctx, cb: (event: TaskEvent) => void): () => Promise<void>
commitTasks(ctx, message?): Promise<void>    // stages tasksDir + git commit

isKnownStatus(config, status): boolean
ARCHIVED_STATUS: "archived"

parseTask(raw, filePath): Task
parseTaskFile(filePath): Promise<Task>
serializeTask(task, mode: "ordna" | "backlog"): string
extractAcceptanceCriteria(sections): AcceptanceItem[]
```

Types: `Task`, `Section`, `AcceptanceItem`, `Priority`, `SchemaMode`, `OrdnaConfig`, `StoreContext`, `TaskCreateInput`, `TaskUpdateInput`, `TaskEvent`.

## Task file format

Each task is one markdown file in `tasks/`. The filename is the ID.

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

Acceptance criteria are plain markdown checkboxes — the file is the source of truth, structured views are derived.

### Dependencies

`depends_on` is enforced by `moveTask`: moving a task to the **terminal status** (last entry of `statuses`, `done` by default) while any dependency is unfinished throws. Other transitions are free.

### Archiving

`archived` is a **reserved built-in status** — accepted by `moveTask` / `updateTask` regardless of whether it's listed in `config.statuses`. Use it to retire tasks without polluting the active board. The two UI packages filter archived tasks out of every other view by default.

## Configuration

`.ordna/config.yaml` is **optional**. With no config, Ordna behaves exactly as documented above. Config only expands.

```yaml
tasksDir: tasks            # where task files live
schema: ordna              # ordna | backlog
statuses: [todo, doing, done]
idPrefix: T                # custom prefix, e.g. BUG, EPIC
zeroPaddedIds: 3           # width of the numeric part (0 = no padding)
webPort: 7420              # consumed by @frehilm/ordna-web
```

The last entry of `statuses` is the **terminal status** for the dependency gate.

## Storage modes

Ordna ships three storage backends. Pick one with a single config key:

```yaml
storage: file        # default
# storage: hybrid    # files + synced ID allocator + audit log in git
# storage: namespace # tasks as git refs; working tree stays clean
```

| Mode | Where tasks live | Working tree | Requires git | Use case |
|---|---|---|---|---|
| `file` | `tasks/*.md` | yes | no | Single-machine, agent-friendly, the default. |
| `hybrid` | `tasks/*.md` + `refs/ordna/state` (next-id + audit log) | yes | yes | Multi-machine collaboration; prevents two offline writers picking the same ID. |
| `namespace` | `refs/ordna/tasks/<id>` (blobs only) | untouched | yes | Decentralised, working-tree-clean, sync via standard `git push`/`fetch`. |

`schema: backlog` is only supported with `storage: file`. `hybrid` and `namespace` require a git repository.

### Auto-detection

When no `.ordna/config.yaml` exists, Ordna inspects the directory and picks a mode:

1. `refs/ordna/tasks/*` refs exist → `namespace`
2. `refs/ordna/state` ref exists → `hybrid`
3. `tasks/*.md` files exist → `file`
4. cwd is a git repo (none of the above) → prompts the user (TUI modal, web setup page, CLI 1/2/3 on TTY)
5. else (no git, no signals) → silently runs in `file` mode

Confident detections (1–3) auto-write `.ordna/config.yaml` so the choice is durable across runs and visible to anyone reading the repo.

### `ORDNA_STORAGE` env var

Set `ORDNA_STORAGE=file|hybrid|namespace` to override both the config file and auto-detection for a single process invocation. Useful for CI (predictable storage mode, no on-disk side effects) and for tests pinning a specific mode against arbitrary directories.

## Backlog.md compatibility

Ordna reads [Backlog.md](https://github.com/MrLesk/Backlog.md) repos out of the box. The parser normalizes both field sets:

| Ordna         | Backlog.md          |
|---------------|---------------------|
| `tags`        | `labels`            |
| `depends_on`  | `dependencies`      |
| `created_at`  | `createdDate`       |
| `updated_at`  | `updatedDate`       |
| `assignee: "x"` or `null` | `assignee: ["x"]` or `[]` |

To open a Backlog repo, point Ordna at its directory and set:

```yaml
tasksDir: backlog
schema: backlog
```

In `schema: backlog` mode the writer uses Backlog-style filenames (`task-1 - title.md`) and field names. Tasks round-trip cleanly between tools.

## Body sections in each schema

| Schema    | Default body sections                                                            |
|-----------|----------------------------------------------------------------------------------|
| `ordna`   | `## Goal` / `## Acceptance Criteria` / `## Notes` / `## Progress`                |
| `backlog` | `## Description` / `## Acceptance Criteria` / `## Implementation Plan` / `## Implementation Notes` / `## Final Summary` |

Section headings are matched case-insensitively, with aliases (`Goal`/`Description`, `Notes`/`Implementation Notes`, `Progress`/`Final Summary`).

## License

MIT — see [LICENSE](../../LICENSE).

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

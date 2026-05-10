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

## Pluggable backends

The storage layer is abstracted behind `TaskProvider`. The built-in `FileTaskProvider` (markdown files in `tasks/`) is the default; any package matching `@frehilm/ordna-<name>` that exports a `createProvider` factory can replace it via `provider: <name>` in `.ordna/config.yaml`.

### The `TaskProvider` interface

```ts
export interface TaskProvider {
  readonly kind: string;                                    // "file" / "jira" / ...

  list(opts?: ListOptions): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  create(input: TaskCreateInput): Promise<Task>;
  update(id: string, patch: TaskUpdateInput): Promise<Task>;
  move(id: string, status: string): Promise<Task>;
  delete(id: string): Promise<void>;

  watch(cb: TaskEventListener): () => Promise<void>;

  init?(): Promise<void>;       // optional — startup hook
  dispose?(): Promise<void>;    // optional — shutdown hook
  commit?(message?: string): Promise<void>;   // optional — file-only semantics
}
```

The `depends_on` gate (refusing a move to the terminal status while dependencies are unfinished) stays in core's `moveTask` — providers don't have to re-implement project-wide business rules.

### Writing a provider

A plugin package is any npm package named `@frehilm/ordna-<name>` that exports a single factory:

```ts
// @frehilm/ordna-acme/src/index.ts
import type { OrdnaConfig, TaskProvider } from "@frehilm/ordna-core";

class AcmeTaskProvider implements TaskProvider {
  readonly kind = "acme";

  constructor(private readonly config: OrdnaConfig, private readonly cwd: string) {}

  async init() {
    // Validate auth, fetch status mapping, open a long-lived connection, etc.
    // Errors thrown here propagate out of `createContext` — the user sees them.
  }

  async dispose() {
    // Close sockets, stop subscriptions. Called by long-lived hosts (web, TUI).
    // Errors thrown here are caught and logged — never block the user's exit.
  }

  // ... implement list / get / create / update / move / delete / watch
}

export function createProvider(config: OrdnaConfig, cwd: string): TaskProvider {
  return new AcmeTaskProvider(config, cwd);
}
```

Users opt in with one line in `.ordna/config.yaml`:

```yaml
provider: acme
acme:                # any plugin-specific config block
  apiKey: ...        # validated by the plugin, not core
```

Core's config schema uses `.passthrough()`, so plugin-specific blocks survive parsing untouched. Validate them inside your provider.

### Lifecycle

- `init()` runs once, awaited inside `createContext` after the provider is constructed. Use it for one-time setup that can fail — auth checks, schema discovery, connection establishment. Throwing here surfaces the error immediately to the CLI command that triggered the context creation.
- `dispose()` runs from `disposeContext(ctx)`, invoked by long-lived hosts (`ordna web` on SIGINT/SIGTERM/`close()`, the TUI on exit). One-shot CLI commands (`create`, `list`, `show`, `move`, `assign`, `commit`) skip `dispose` — the process exits and the OS reclaims resources. Errors thrown from `dispose` are caught and logged to stderr; they never block shutdown.

### `commit` semantics

`commit?(message?)` is **file-only**. The built-in `FileTaskProvider` implements it as `git add <tasksDir> && git commit -m <message>`. Remote providers (Jira, Linear, anything API-backed) leave this method undefined — `commitTasks(ctx)` then throws a clear error pointing the user at the remote tracker's own sync flow. If your backend has no working-tree concept, don't implement `commit`.

### Loader errors

Core's `loadProvider` is precise about what went wrong:

| Situation | Error message shape |
|---|---|
| `provider: jira` but the package isn't installed | `Provider "jira" not installed. Run: pnpm add @frehilm/ordna-jira` |
| Package installed but no `createProvider` export | `Provider package "@frehilm/ordna-jira" does not export a \`createProvider(config, cwd)\` factory. ...` |
| `provider: file` (the built-in) | Always resolves — no dynamic import |

The actionable install hint is intentional: a misconfigured `provider:` key is the most common reason a CLI command fails on first run with a new backend, and the message should point users straight at the fix.

## License

MIT — see [LICENSE](../../LICENSE).

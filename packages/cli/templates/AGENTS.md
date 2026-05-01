# Ordna — Agent Guide

This project uses **Ordna**, a Git-native project management framework. Tasks
are markdown files in `tasks/`, the Kanban board is *derived* from those files,
and Git is the source of truth. There is no database, no API key, no central
board file. If you can read and write a markdown file, you can manage tasks.

This document describes:

1. The repository layout
2. The task file format
3. The config file (`.ordna/config.yaml`)
4. The `ordna` CLI

---

## 1. Repository layout

```
tasks/
  T-001.md         # one file per task
  T-002.md
.ordna/
  config.yaml      # optional — see §3
```

The `tasks/` folder is the entire schema. Adding a file creates a task;
deleting a file removes one. The Kanban board is computed from the `status`
field of each file. There is no separate board state to keep in sync.

---

## 2. Task file format

Each task is a single markdown file with **YAML frontmatter** and a body
divided into well-known sections.

### Filename

`tasks/<id>.md` where `<id>` is `idPrefix` + zero-padded number. With defaults
(`idPrefix: T`, `zeroPaddedIds: 3`): `T-001.md`, `T-002.md`, `T-042.md`.

### Frontmatter

```yaml
---
id: T-001
title: Implement payment flow
status: todo
assignee: null
priority: high
tags: [payments]
depends_on: []
created_at: 2026-04-30
updated_at: 2026-04-30
---
```

| Field         | Type                                   | Notes                                                              |
|---------------|----------------------------------------|--------------------------------------------------------------------|
| `id`          | string                                 | Must match the filename.                                           |
| `title`       | string                                 | Plain text.                                                        |
| `status`      | string                                 | One of the configured statuses (default: `todo` / `doing` / `done`). |
| `assignee`    | string \| null                         | Username, freeform.                                                |
| `priority`    | `high` \| `medium` \| `low` \| null    |                                                                    |
| `tags`        | string[]                               | Empty list `[]` if none.                                           |
| `depends_on`  | string[]                               | Task IDs (e.g. `[T-002, T-007]`). Empty list if none.              |
| `created_at`  | ISO date `YYYY-MM-DD`                  |                                                                    |
| `updated_at`  | ISO date `YYYY-MM-DD`                  | Bump to today on every edit.                                       |

Extra frontmatter keys are preserved on write but ignored by the board.

### Body sections (Ordna schema, default)

```markdown
## Goal
What this task accomplishes.

## Acceptance Criteria
- [ ] Criterion one
- [ ] Criterion two

## Notes
Anything that doesn't fit elsewhere.

## Progress
Append-only log of what has happened so far.
```

The `Acceptance Criteria` checkboxes (`- [ ]` / `- [x]`) are the source of
truth for AC progress — they are parsed structurally; there is no separate
frontmatter field for them.

### Backlog.md compatibility

Ordna can read repos that follow the
[Backlog.md](https://github.com/MrLesk/Backlog.md) schema. When
`.ordna/config.yaml` sets `schema: backlog`, files are *written* with:

- Frontmatter aliases: `labels` (instead of `tags`), `dependencies` (instead
  of `depends_on`), `createdDate` / `updatedDate` (instead of `created_at` /
  `updated_at`).
- Body sections: `## Description`, `## Acceptance Criteria`,
  `## Implementation Plan`, `## Implementation Notes`, `## Final Summary`.

The parser accepts **both** schemas regardless of mode; only the writer
follows the configured schema. Inspect `.ordna/config.yaml` before guessing
which schema a repo uses.

### Status model

Default: `todo → doing → done`. Statuses are configurable via
`.ordna/config.yaml`, but with no config file present, exactly these three
exist and form the Kanban columns left-to-right.

Moving a task to `done` while any task in its `depends_on` list is not yet
`done` is **rejected** by the CLI. Either complete the dependencies first or
remove them.

### IDs

IDs are zero-padded with the configured prefix. Defaults: prefix `T`, 3-digit
padding → `T-001`, `T-002`, …, `T-1000`. Each new task is auto-incremented
from the highest existing numeric ID. Merge conflicts on IDs are resolved by
the developer — Ordna does not renumber files.

---

## 3. Config — `.ordna/config.yaml`

The config file is **optional**. With no config file, Ordna behaves exactly
as documented above.

```yaml
# All keys are optional; defaults shown.
tasksDir: tasks                         # folder Ordna scans for task files
schema: ordna                           # "ordna" | "backlog"
statuses: [todo, doing, done]           # Kanban columns, in left-to-right order
idPrefix: T                             # prefix used when generating new IDs
zeroPaddedIds: 3                        # digits of zero-padding (0–10)
webPort: 7420                           # default port for `ordna web`
```

| Key             | Default               | Notes                                                                |
|-----------------|-----------------------|----------------------------------------------------------------------|
| `tasksDir`      | `tasks`               | Path is relative to the project root.                                |
| `schema`        | `ordna`               | Controls *write* format; reader accepts both.                        |
| `statuses`      | `[todo, doing, done]` | At least one entry required. Order = column order.                   |
| `idPrefix`      | `T`                   | One prefix per project.                                              |
| `zeroPaddedIds` | `3`                   | `0` disables padding. Range `0..10`.                                 |
| `webPort`       | `7420`                | Overridable via `ordna web --port N`.                                |

**Rules**

- The file lives at `.ordna/config.yaml` in the project root.
- Configuration is **additive** — it expands capability (more statuses, custom
  folder, Backlog compat) but never replaces the documented defaults.
- Changing `tasksDir` only changes where Ordna *looks*; existing files are not
  moved for you.
- `statuses` defines the columns 1:1, in order. The first status is the
  default for newly-created tasks unless `--status` is passed.

---

## 4. The `ordna` CLI

Binary: `ordna` (provided by `@frehilm/ordna-cli`). Run inside the project
directory.

| Command                                  | What it does                                                       |
|------------------------------------------|--------------------------------------------------------------------|
| `ordna init`                             | Create `.ordna/config.yaml` and `tasks/` if missing.               |
| `ordna list` / `ordna ls`                | List tasks. Filter with `-s <status>`, `-a <assignee>`, `-t <tag>`.|
| `ordna show <id>`                        | Print a task's frontmatter + body to stdout.                       |
| `ordna create <title…>`                  | Create a task. See options below.                                  |
| `ordna move <id> <status>`               | Move a task. Rejected if `done` and any `depends_on` task isn't done. |
| `ordna assign <id> [name]`               | Assign a task; omit `name` to unassign.                            |
| `ordna commit -m "msg"`                  | Stage `tasks/` and `git commit`. **Never auto-runs.**              |
| `ordna web [--port N] [--host H]`        | Start the local web Kanban (opens browser).                        |
| `ordna board` (or just `ordna`)          | Open the Kanban TUI.                                               |
| `ordna skill install [--out p] [--from u] [--force]` | Install this AGENTS.md guide into a project.           |

### `ordna create` options

```
-a, --assignee <name>           assignee
-p, --priority <high|medium|low>
-t, --tag <tag...>              one or more tags
-d, --depends-on <id...>        one or more dependency IDs
-s, --status <status>           initial status (defaults to first configured)
```

### Examples

```bash
ordna init
ordna create "Implement payment flow" -p high -t payments
ordna create "Write tests" -d T-001              # depends on T-001
ordna list -s todo
ordna move T-001 doing
ordna assign T-001 fredrik
ordna show T-001
ordna commit -m "tasks: progress on T-001"
```

### Exit codes

- `0` — success
- `1` — user-visible error (missing task, blocked dependency, invalid status, etc.)

### What the CLI does **not** do

- Auto-commit. Commits are always explicit (`ordna commit` or `git commit`).
- Renumber IDs. ID conflicts after merges are resolved manually.
- Maintain hidden state. Everything visible in the UI is on disk.

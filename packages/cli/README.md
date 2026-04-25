# @frehilm/ordna-cli

The `ordna` binary plus an embeddable Ink-based Kanban TUI. Re-exports the entire [@frehilm/ordna-core](../core/README.md) API, so this is the only Ordna package you need if you're a terminal user or embedding the TUI in an IDE.

## Install

Global binary:

```bash
npm i -g @frehilm/ordna-cli   # provides the `ordna` command
```

As a library:

```bash
pnpm add @frehilm/ordna-cli
```

## CLI commands

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
ordna move <id> <status>  Change status (depends_on gate on the terminal status)
ordna assign <id> [name]  Omit name to unassign
ordna commit [-m msg]     Stage tasks/ and git commit
ordna web [-p port]       Start the local web Kanban (delegates to @frehilm/ordna-web)
```

## TUI

Launch with `ordna` or `ordna board`. Three-pane layout: topbar · filter sidebar · board (columns) · subbar · footer hints.

| Key            | Action                                   |
|----------------|------------------------------------------|
| `Tab`          | Toggle focus between sidebar and board   |
| `← → / h l`    | Switch column                            |
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

### Sidebar

`Views` (All · per-status counts · Archived) · `Priority` (high / medium / low) · `Tags` (top 8 by usage). Counts are live; selected filter scopes the board and the subbar title.

### Columns

- Double-line border, colored dot for the status, title + count.
- Single-line rows: `› T-001  !h  Title  #tag @user  ███░░ 3/5  ↪1` — priority letter, colored tag chips, assignee, acceptance-criteria progress bar, depends-on count.
- Scrolling: when a column overflows, `↑ N more` and `↓ N more` appear. Selection auto-scrolls to stay visible. Moving a task scrolls the target column to reveal it.
- Columns fill the available width evenly. The Archived view keeps a single-column width so it doesn't dominate.

### Popup

`Enter` on a task opens a centered modal with the full body. `e` opens in `$EDITOR`. `Esc` / `q` closes.

### Behavior

The TUI runs in the **alternate screen buffer** so it never pollutes your scrollback, and reloads automatically when task files change on disk (CLI, web, agent, editor — they all show up live).

## Embedded use

```ts
import { runBoard } from "@frehilm/ordna-cli";

await runBoard({
  agentHook: {
    url: "http://127.0.0.1:9999/agent",
    label: "Claude",
    headers: { "X-Token": "..." },
  },
});
```

For a full IDE embedding (xterm.js + node-pty pane), see the [Host integration](../../README.md#host-integration) section in the root README.

## Configuration

Inherits everything from [@frehilm/ordna-core](../core/README.md#configuration). The CLI does not add or override any keys.

## License

MIT — see [LICENSE](../../LICENSE).

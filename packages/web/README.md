# @frehilm/ordna-web

A local Kanban for [Ordna](../../README.md) in your browser. Hono server + prebuilt React SPA. Re-exports the entire [@frehilm/ordna-core](../core/README.md) API — no separate core install needed.

## Install

```bash
pnpm add @frehilm/ordna-web
```

If you also have `@frehilm/ordna-cli` globally, just run `ordna web` — it delegates here.

## Run standalone

```bash
ordna web
# → opens http://127.0.0.1:7420 in your browser
```

Flags: `--port <n>`, `--host <h>`, `--no-open`.

## Run programmatically

```ts
import { runWeb } from "@frehilm/ordna-web";

const handle = await runWeb({
  cwd: "/path/to/repo",
  port: 0,                       // OS-assigned
  openBrowser: false,
  agentHook: {                   // optional
    url: "http://127.0.0.1:9999/agent",
    label: "Claude",
    headers: { "X-Token": "..." },
  },
});

console.log(`Listening on http://127.0.0.1:${handle.port}`);
await handle.close();            // graceful shutdown
```

## Web UI

- **Topbar**: brand, tasks-dir crumb, search, theme toggle, shortcuts, primary `+ New task`.
- **Sidebar**: Views (All + per-status + Archived) · Priority · Tags. Counts are live.
- **Subbar**: current view title and visible/total counts.
- **Board**: columns per configured status, drag-and-drop with a rotated floating overlay and optimistic updates (rolls back on server rejection).
- **Cards**: id, priority chip, title, tag chips (hashed colors), bottom meta (assignee + AC progress). Hover reveals Edit / Delete action buttons. Click opens a view-mode modal.
- **Modal**: read-only by default. Press **Edit** for in-place editing — title, status, priority, assignee, tags (chip input), depends_on (chip input), structured acceptance-criteria checklist, section textareas. Save / Cancel.
- **Theme**: light / dark toggle, persisted in `localStorage`.

## Keyboard shortcuts

| Key            | Action                          |
|----------------|---------------------------------|
| `⌘/Ctrl + K`   | Command palette                 |
| `n`            | New task                        |
| `/`            | Focus search                    |
| `t`            | Toggle theme                    |
| `?`            | Toggle shortcut cheatsheet      |
| `Esc`          | Close modal / overlay           |

## Live updates

Everything is over WebSocket. Changes from the TUI, CLI, an editor, an agent script, or another browser tab show up instantly. The web process is local — nothing leaves the machine.

## REST API

If your IDE wants to talk to the running server directly:

```
GET    /api/config            Returns the resolved OrdnaConfig + agentHook info
GET    /api/tasks             All tasks
GET    /api/tasks/:id         One task
POST   /api/tasks             Create
PATCH  /api/tasks/:id         Update
POST   /api/tasks/:id/move    Change status (depends_on gate)
DELETE /api/tasks/:id         Delete
POST   /api/tasks/:id/agent   Forward to ORDNA_AGENT_HOOK_URL (501 if unset)
WS     /ws                    Broadcasts {added | changed | removed}
```

Bodies are JSON; `Task` shape comes from [@frehilm/ordna-core](../core/README.md#api).

## Configuration

Inherits from [@frehilm/ordna-core](../core/README.md#configuration). The relevant key for this package is `webPort` (default `7420`).

The agent hook is configured via env (`ORDNA_AGENT_HOOK_URL`, `ORDNA_AGENT_HOOK_LABEL`, `ORDNA_AGENT_HOOK_HEADERS`) **or** programmatically via the `agentHook` option on `runWeb`. The programmatic option wins. Pass `null` to disable explicitly.

## License

MIT — see [LICENSE](../../LICENSE).

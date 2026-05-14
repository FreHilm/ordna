# @frehilm/ordna-linear

Linear backend for [Ordna](../../README.md). Plugs into the `TaskProvider` interface so the CLI / TUI / Web UI can drive a Linear team's board the same way they drive markdown files in `tasks/`.

`0.1.x` is **read-only** (`list` / `get` / `watch`). Write support — create, update, state transition, delete — lands in `0.2.x`.

## Install

```bash
pnpm add @frehilm/ordna-linear
# or:    npm i @frehilm/ordna-linear
```

Peer-depends on `@frehilm/ordna-core@^0.2.0`.

## Setup

1. **Create a Linear API key** at https://linear.app/settings/api → **Personal API keys** → **New API key**. Give it the scopes you need (read at minimum). Copy the value.

2. **Find your team ID**. Either:
   - In Linear, open any issue in the team → URL is `linear.app/<workspace>/issue/<TEAM>-<n>/...`. The `<TEAM>` part is the team's identifier *prefix*, not its UUID. You need the UUID for the config.
   - Or: visit https://linear.app/settings/api and copy the team's UUID from the API explorer.

3. **Export the API key**:

   ```bash
   export LINEAR_API_KEY=lin_api_…
   ```

4. **Configure `.ordna/config.yaml`**:

   ```yaml
   provider: linear
   linear:
     apiKeyEnv: LINEAR_API_KEY            # name of the env var holding the key
     teamId: <team-uuid>                  # the team to read from
     # endpoint: https://api.linear.app/graphql      # optional override
     # wsEndpoint: wss://api.linear.app/graphql      # optional WS override
     # pollIntervalMs: 30000                          # optional — default 30s
   ```

5. **Run Ordna as normal**:

   ```bash
   ordna list           # lists Linear issues, not markdown files
   ordna show T-42      # opens ENG-42
   ordna board          # TUI with native Linear column names
   ordna web            # browser Kanban over Linear
   ```

The Linear plugin **overrides `config.statuses` at startup** with the team's actual workflow states (sorted by Linear's `position` field), so the board columns reflect the team's workflow ("Backlog", "Todo", "In Progress", "In Review", "Done", etc.) rather than Ordna's defaults.

## What gets mapped

| Ordna `Task` field | Linear field | Notes |
|---|---|---|
| `id` | `identifier` | `ENG-42` → `T-042` (uses your `idPrefix` and `zeroPaddedIds`) |
| `title` | `title` | |
| `status` | `state.name` | Lowercased; workflow discovered at init |
| `assignee` | `assignee.displayName` | Single assignee only |
| `priority` | `priority` (0–4) | 1/Urgent + 2/High → `high`; 3/Medium → `medium`; 4/Low → `low`; 0/None → `null` |
| `tags` | `labels.nodes[].name` | |
| `depends_on` | `relations` of type `blocks` | |
| `sections` | `description` | Wrapped in a single `## Description` section. Linear stores markdown natively, so no conversion is needed (compare to Jira's ADF). |
| `created_at` / `updated_at` | `createdAt` / `updatedAt` | Date prefix only |
| `remote.externalId` | `identifier` | |
| `remote.url` | `url` | The "Open in Linear" link |
| `remote.extras.cycle` | `cycle.name` | Active cycle when present |
| `remote.extras.project` | `project.name` | |
| `remote.extras.parentIssue` | `parent.identifier` | |

## Watch strategy

Hybrid. The provider attempts a GraphQL subscription over WebSocket first (via [`graphql-ws`](https://the-guild.dev/graphql/ws)). If the connection establishes, issue updates stream in real-time. If anything fails — handshake refused, protocol mismatch, stream error mid-flight — the provider falls back to polling at `pollIntervalMs` (default 30s) without dropping events.

**Caveat:** Linear's public API documentation doesn't currently advertise GraphQL subscriptions. The subscription path is speculative — if Linear ships subscriptions or you're on a beta endpoint that supports them, this code will use them; otherwise polling is the de facto watch mechanism. Tune `pollIntervalMs` if 30s feels too slow.

To force polling (e.g. behind a firewall that blocks `wss://`), set a deliberately invalid `wsEndpoint` like `wsEndpoint: wss://127.0.0.1:1` — the subscription will fail fast and the polling path kicks in.

## What's lossy

| Linear concept | Why not mapped |
|---|---|
| Comments | No 1:1 Ordna concept |
| Subscribers / watchers | Not part of the Ordna data model |
| Multiple assignees | Linear is also single-assignee, so this isn't really lossy |
| Attachments | Out of scope for v1 |
| Subissues | Currently flattened into the main issue list; the parent identifier surfaces via `remote.extras.parentIssue` |
| State transitions | `move()` is a 0.2.x feature |

## Rate limits

Linear surfaces rate limits as HTTP 429 with a `Retry-After` header. The plugin:

- Honours `Retry-After` exactly when present.
- Falls back to exponential backoff (1s → 2s → 4s, ±25% jitter) when absent.
- Retries up to 3 times on 429 and transient 5xx; further failures propagate.

Linear's GraphQL endpoint also enforces query complexity limits. We use a fixed page size of 100 and orderBy `createdAt` to keep each request cheap.

## Errors

Linear error messages pass through verbatim:

```
Linear GraphQL error: Field "issue" of type "Issue" must have a selection of subfields. Did you mean "issue { ... }"?
```

For 4xx HTTP errors (e.g. bad API key), the response body is surfaced in the error message:

```
Linear 401 Unauthorized: Authentication required
```

## Limitations of 0.1.x

- **Read-only.** All write methods throw a clear "not implemented in 0.1.x" message. Use Linear's UI for create / transition / edit.
- **One team at a time.** The config specifies a single `teamId`; cross-team boards aren't supported.
- **No comment surface.** Issue title + description only.
- **No `commit`.** `ordna commit` errors loudly — Linear has its own audit trail; there's no analogue.

## License

MIT — see [LICENSE](../../LICENSE).

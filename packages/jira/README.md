# @frehilm/ordna-jira

Jira backend for [Ordna](../../README.md). Plugs into the `TaskProvider` interface so the CLI / TUI / Web UI can drive a Jira board the same way they drive markdown files in `tasks/`.

`0.1.x` is **read-only** (list / get / watch). Write support — create, update, transition, delete — lands in `0.2.x`.

## Install

```bash
pnpm add @frehilm/ordna-jira
# or:    npm i @frehilm/ordna-jira
```

This package has `@frehilm/ordna-core@^0.2.0` as a peer dependency.

## Setup

1. **Generate a Jira API token** at https://id.atlassian.com/manage-profile/security/api-tokens. Copy it. (It's only shown once.)

2. **Export the token** in the shell that runs Ordna:

   ```bash
   export JIRA_TOKEN=…paste-the-token-here…
   ```

3. **Configure `.ordna/config.yaml`** in your project root:

   ```yaml
   provider: jira
   jira:
     baseUrl: https://acme.atlassian.net    # your Jira Cloud URL
     email: you@example.com                 # the account that owns the token
     apiTokenEnv: JIRA_TOKEN                # name of the env var holding the token
     projectKey: ENG                        # the project to read from
     jql: "sprint in openSprints()"         # optional — defaults to "project = <key> AND statusCategory != Done"
     pollIntervalMs: 30000                  # optional — default 30s
   ```

4. **Run Ordna as normal**:

   ```bash
   ordna list           # lists Jira issues, not markdown files
   ordna show T-42      # opens ENG-42
   ordna board          # TUI with native Jira column names
   ordna web            # browser Kanban over Jira
   ```

The Jira plugin **overrides `config.statuses` at startup** with the actual workflow states from your project — your board columns become "To Do / In Progress / Code Review / Done" (or whatever your workflow uses), not Ordna's defaults.

## What gets mapped

| Ordna `Task` field | Jira REST field | Notes |
|---|---|---|
| `id` | `key` | `ENG-7` → `T-007` (uses your `idPrefix` and `zeroPaddedIds`) |
| `title` | `fields.summary` | |
| `status` | `fields.status.name` | Lowercased; column set discovered at init |
| `assignee` | `fields.assignee.displayName` | Single assignee only |
| `priority` | `fields.priority.name` | `Highest`/`High` → `high`; `Medium` → `medium`; `Low`/`Lowest` → `low`; others → `null` |
| `tags` | `fields.labels` | |
| `depends_on` | `issuelinks` of type `Blocks` (inward) | Outward "blocks" links are ignored |
| `sections` | `fields.description` | ADF → markdown via the bundled converter; lands under a `## Description` section |
| `created_at` / `updated_at` | `fields.created` / `fields.updated` | Date prefix only |
| `remote.externalId` | `key` | |
| `remote.url` | `${baseUrl}/browse/${key}` | The "Open in Jira" link |
| `remote.extras.sprint` | discovered `Sprint` custom field | Active sprint name when present |
| `remote.extras.storyPoints` | discovered `Story Points` custom field | Numeric |
| `remote.extras.epic` | discovered `Epic Link` custom field | Issue key |

**Discovered automatically.** The plugin calls `/rest/api/3/field` once at startup and matches custom fields by name (Sprint / Story Points / Epic Link). No need to hardcode `customfield_10020`-style IDs.

## What's lossy

| Jira concept | Why not mapped |
|---|---|
| Comments | No 1:1 Ordna concept; not enough room in a Task |
| Watchers | Not part of the Ordna data model |
| Multiple assignees | Ordna assignee is single-valued |
| Reporter | Available via the URL link; not duplicated into `Task` |
| Attachments | Out of scope for v1 |
| Subtasks | Currently flattened into the main issue list |
| Workflow transitions | `move()` is a 0.2.x feature |

## How watching works

Polling, at `pollIntervalMs` (default 30s). Each poll:

1. Run the same JQL search used by `list()`.
2. Diff against the previous snapshot by `(id, updated_at)`.
3. Emit `added` / `changed` / `removed` events through the standard `TaskEvent` shape — same wire format as the file provider.

No webhooks in `0.1.x`. Webhook receivers need a public URL, which Ordna doesn't have by default. If you have one, that path is on the roadmap.

## Rate limits

Jira Cloud rate-limits per-token and per-IP. The plugin:

- Reads `Retry-After` on `429` responses and waits exactly that long before retrying.
- Falls back to exponential backoff (1s → 2s → 4s, ±25% jitter) when no `Retry-After` is provided.
- Retries up to 3 times on `429` and transient `5xx`; further failures propagate to the caller.

If you're hitting limits constantly, raise `pollIntervalMs` and / or narrow your JQL.

## Errors

Jira's error messages pass through verbatim:

```
Jira 400 Bad Request on POST /rest/api/3/search: Field 'sprintz' does not exist or you do not have permission to view it.
```

The plugin doesn't try to translate workflow errors. If a future `move()` call gets rejected by a Jira workflow rule, the rule's own message ("Transition is not valid for the current status") surfaces to the user.

## Limitations of 0.1.x

- **Read-only.** All write methods throw with a clear "not implemented in 0.1.x" message. Use Jira's UI for create / transition / edit.
- **One project at a time.** Cross-project boards aren't supported. Configure two projects → run two Ordna instances.
- **No comment surface.** You can read the issue title and description but not its comments.
- **No `commit`.** `ordna commit` errors loudly — Jira has its own audit trail; there's no analogue.

## License

MIT — see [LICENSE](../../LICENSE).

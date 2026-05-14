# @frehilm/ordna-ref

Ref-based storage backend for [Ordna](../../README.md). Stores tasks as git blobs under `refs/ordna/tasks/<id>` instead of as `.md` files in `tasks/`. Working tree stays clean. Tasks survive branch switches. No `tasks/` directory pollutes your repo.

For users who want git-native, decentralized task management *and* a working tree free of task clutter. Inspired by [git-bug](https://github.com/git-bug/git-bug), but deliberately simpler — one blob per task at one ref per task; no CRDT op-log.

## Install

```bash
pnpm add @frehilm/ordna-ref
# or:    npm i @frehilm/ordna-ref
```

Peer-depends on `@frehilm/ordna-core@^0.2.0`.

## Setup

1. **Make sure you're in a git repository.** The provider needs `.git/` to write refs into.

   ```bash
   git init        # if you're not already
   ```

2. **Configure `.ordna/config.yaml`**:

   ```yaml
   provider: ref
   # ref:
   #   pollIntervalMs: 1000     # optional — default 1s
   ```

3. **Run Ordna as normal**:

   ```bash
   ordna list           # lists git refs, not files
   ordna show T-001     # reads the blob at refs/ordna/tasks/T-001
   ordna board          # TUI
   ordna web            # browser Kanban
   ```

Notice what doesn't happen: no `tasks/` directory is ever created. `git status` stays clean. `git log` on your code branches doesn't show task mutations.

## How it works

Each task is one git blob. A ref at `refs/ordna/tasks/<id>` points at the blob. The blob's contents are the same markdown + frontmatter Ordna's file backend writes, so a task can round-trip between modes:

```
refs/ordna/tasks/T-001 → blob (sha: 8a3f2b…)
                              ↓
                              ---
                              id: T-001
                              title: Implement payment flow
                              status: doing
                              ...
                              ---

                              ## Goal
                              …
```

Four git plumbing calls drive everything:

- `git hash-object -w --stdin` — write a blob
- `git cat-file blob <oid>` — read a blob
- `git update-ref refs/ordna/tasks/<id> <oid> [<expected-old>]` — atomic ref write with compare-and-swap
- `git for-each-ref refs/ordna/tasks/*` — list

No commits. No tags. No branches. Just blobs and refs.

## Syncing across machines

Refs outside `refs/heads/*` don't ride along with `git push` by default. Two options:

**One-time refspec configuration** (recommended):

```bash
git config --add remote.origin.push '+refs/ordna/tasks/*:refs/ordna/tasks/*'
git config --add remote.origin.fetch '+refs/ordna/tasks/*:refs/ordna/tasks/*'
```

After that, plain `git push` and `git fetch` sync tasks alongside your branches. Run this once per clone.

**Per-invocation** (one-shot syncs without persistent config):

```bash
git push origin '+refs/ordna/tasks/*:refs/ordna/tasks/*'
git fetch origin '+refs/ordna/tasks/*:refs/ordna/tasks/*'
```

## Trade-offs

| Gain | Lose |
|---|---|
| Working tree stays clean. No `tasks/` in `git status` or PR diffs. | `cat tasks/T-001.md` no longer works. Reading requires `ordna show T-001`. |
| Tasks survive branch switches. `git checkout main` doesn't change your task list. | Agent integration weakens. Claude / Cursor edit files directly today; here they'd shell out to `ordna` for every mutation. |
| Decentralized sync via any git remote. No central server. | `git push` doesn't auto-sync unless the refspec is configured (see above). |
| Atomic concurrency via `update-ref` compare-and-swap. | No automatic merge. Plain markdown files get `git merge` for free; refs don't. Concurrent edits to the same task from two machines are detected by the CAS and surface as "ref moved underneath you" errors — the user pulls and retries. |
| Cheap. 10,000 tasks ≈ 3 MB on disk, content-deduplicated. | `schema: backlog` is unsupported. The Backlog filename convention has no analogue here; the provider refuses to start. |

## Concurrency model

- **In-flight protection.** `update()` reads the current ref OID, builds the new task, hashes the new blob, then `update-ref`s with `expected-old = <captured OID>`. If another writer has changed the ref in the meantime, git refuses and the user sees a clear "ref moved underneath" error.
- **Sequential safety.** Two CLI invocations one after the other each see the latest state — they never conflict.
- **No silent overwrites.** A `--force` push from one machine to another *can* still overwrite — same as with branches. We don't (and can't) defend against that at the plugin layer.

## Watch behavior

Polling. Every `pollIntervalMs` (default 1 s) the provider runs `git for-each-ref` and emits `TaskEvent`s for any blob whose OID has changed. No filesystem watches — refs don't have a kernel notification path, and reading `.git/refs/` directly breaks the moment refs get packed.

For huge ref namespaces (5000+ tasks, low-end machines), bump `pollIntervalMs` to 5–10 s.

## What `commit` does

Nothing. Deliberately.

The file backend's `commit()` runs `git commit` on the `tasks/` directory. Refs live outside the working tree, so there's nothing to stage. We could alias `commit` to a push, but that would surprise users with unexpected network calls on every `ordna commit`. Sync is a separate, explicit step — see "Syncing across machines" above.

`ordna commit` therefore succeeds with no output when `provider: ref` is set.

## Limitations of 0.1.x

- **Polling-only watcher.** No kernel-level change notification for refs (see above). The 1 s default is responsive but not free; tune `pollIntervalMs` for huge ref namespaces.
- **`schema: backlog` unsupported.** Backlog's filename convention is file-specific; the provider rejects this config combination at startup.
- **Agent integration is via the CLI.** Claude / Cursor can't `cat tasks/T-001.md` because there's no file. Use `ordna show <id>` and `ordna update <id>` instead. The AI skill should grow a "if `provider: ref`, use these commands instead" note when this provider becomes commonly used.

## License

MIT — see [LICENSE](../../LICENSE).

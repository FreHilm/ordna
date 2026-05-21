---
name: orchestrate-init
description: >-
  One-time setup for using /orchestrate in a new project. Detects whether
  you're in a single git repo, a git umbrella repo containing nested repos,
  or a non-git root holding multiple independent repos, and initialises ordna
  accordingly. Adds the 5-column status flow (todo / doing / review / blocked
  / done), wires .claude/worktrees/ into every relevant .gitignore, starts
  the kanban web UI, and commits the initial state where git exists.
---

You are setting up a project so that /orchestrate works end-to-end.

This is a **one-time setup**, not the per-feature workflow. Run it the first time the user wants orchestration in a project — usually right after `git init`, or when they ask to "use orchestrate here" inside a multi-repo working tree.

## Step 1 — Install ordna if missing

```bash
ordna --version
```

If `ordna` is not on PATH, install it for the user (it's a public npm package, no auth):

```bash
npm i -g @frehilm/ordna-cli
```

Verify with `ordna --version` afterwards. If npm itself is missing, point the user at https://github.com/FreHilm/ordna for alternative install paths and stop.

## Step 2 — Detect the environment mode

The skill supports three modes, picked automatically from the current working directory:

| Mode | Detection | Where the board lives | Where app code commits land |
|---|---|---|---|
| **single** | CWD is a git repo, no nested `.git/` dirs at depth 1 | CWD | CWD |
| **umbrella** | CWD is a git repo AND has subdirs that are themselves git repos | CWD (board tracked at umbrella) | target subrepo per task |
| **non-git-root** | CWD is not a git repo, but subdirs are | CWD (board local-only, never committed) | target subrepo per task |

Detect with:

```bash
is_repo=$(git -C "$PWD" rev-parse --is-inside-work-tree 2>/dev/null || echo no)
nested=$(find . -maxdepth 2 -name .git -type d -not -path ./.git -printf '%h\n' 2>/dev/null | head -5)

if [ "$is_repo" = "true" ] && [ -z "$nested" ]; then
    MODE=single
elif [ "$is_repo" = "true" ] && [ -n "$nested" ]; then
    MODE=umbrella
elif [ "$is_repo" != "true" ] && [ -n "$nested" ]; then
    MODE=non-git-root
else
    MODE=empty
fi
echo "Mode: $MODE"
[ -n "$nested" ] && echo "Subrepos: $nested"
```

If `MODE=empty` (no git anywhere), ask the user whether they want to `git init` here and proceed in `single` mode, or stop.

If running this from inside a `.claude/worktrees/agent-*/` checkout, refuse and tell the user to switch to the main checkout first.

Tell the user which mode you detected and which subrepos you found before going further. They may override (e.g. "treat this as single, ignore the nested ones").

## Step 3 — Initialise ordna (all modes)

```bash
ordna init
```

This creates `.ordna/config.yaml` with the default `[todo, doing, done]`. **You must now edit it** to expand the status list — the `/orchestrate` workflow assumes `review` and `blocked` exist alongside `todo` / `doing` / `done`, and will fail to move a task into a status that's not declared here. Use your agent's file-edit tool to replace the `statuses:` line so the file ends up as:

```yaml
# .ordna/config.yaml
tasksDir: tasks
schema: ordna
statuses: [todo, doing, review, blocked, done]
idPrefix: T
zeroPaddedIds: 3
webPort: 7420
```

Don't skip the edit. If you only run `ordna init` and don't expand the statuses, `/orchestrate` will refuse to move tasks to `review` or `blocked` and the workflow stalls.

Why 5 columns:
- `todo` — created, not started
- `doing` — implementation agent assigned, code in flight
- `review` — implementation done, reviewers running or review feedback being addressed
- `blocked` — reviewer raised BLOCKER/MAJOR that orchestrator must address before ship
- `done` — reviews clean, code merged, ACs ticked

Tag vocabulary the workflow expects (these aren't enforced — just convention):
- `pending-review` — reviewers spawned, awaiting verdict
- `blocker` — reviewer found a BLOCKER; needs orchestrator action before ship
- `disagreement` — reviewers disagreed; surface to user (do not silently pick one)
- `ready-to-ship` — reviews clean, ACs ticked, ready for the user to verify in browser

Per-task body convention (so the verdict is visible at a glance when you open a card):
- `## 🧱 Implementation`
- `## 🔍 Strict-Correctness Review — <date>`
- `## 👀 Fresh-Claude Review — <date>`
- `## 🔍👀 Combined Review — <date>` (when one reviewer covers both angles)
- `## 🛠️ Orchestrator Post-Review Fixes — <date>`

In **umbrella** and **non-git-root** modes, each task carries the target subrepo on three surfaces so it's visible everywhere AND machine-readable. `/orchestrate` will set all three when it creates tasks:

1. **Title prefix**: `[<subrepo>] <real title>` — shows in TUI, web cards, `ordna list`. Use `[multi]` only for tasks that genuinely span repos and can't reasonably be split.
2. **ordna tag**: created with `ordna create "..." -t <subrepo>`. Lands in YAML `tags:` and renders as a badge in the web UI.
3. **Body header** (the one the orchestrator parses): first content line of the body is
   ```
   **Target repo:** frontend
   ```

The orchestrate skill reads the body header and routes worktrees / `git diff` / app-code commits into that subrepo. The title prefix and tag are for humans / the UI. All three must agree. Without the body header, multi-repo modes can't function.

`/orchestrate` will also INFER the target when the user doesn't specify it — using PR URLs, mentioned file paths, code-symbol greps, and project-specific terminology from this repo's CLAUDE.md. See `orchestrate.md` "Determining the target repo" for the inference order.

## Step 4 — Decide visibility (mode-dependent)

### Mode = single

Use `AskUserQuestion` with these options:

- **Shared** (recommended for team projects on GitHub) — commit `.ordna/config.yaml` AND `tasks/` so the board is part of the repo. Everyone sees the same columns and the task history. Reviewers can see what was planned + done by reading the markdown task files.
- **Private** (solo work, or personal tracking on a shared repo) — gitignore `.ordna/` and `tasks/` entirely. Your board is local; the repo stays clean of orchestration artifacts.
- **Config-only** (middle ground) — commit `.ordna/config.yaml` (so the column layout is durable across machines and matches everyone's expectations) but gitignore `tasks/` (so individual contributors keep their own task lists). Use this when the team agrees on the workflow but doesn't want a shared kanban.

Default to **Shared** if the user doesn't have a preference and the repo has more than one author (`git shortlog -sn | wc -l > 1`).

### Mode = umbrella

Same three options as `single`, but they apply to the **umbrella** repo's tracking (the subrepos are independent and keep their own histories). Default to **Shared** for the umbrella when the user has no preference and the umbrella has commits already.

### Mode = non-git-root

Skip the question — there's no git at the root, so the board is local-only by definition. Tell the user the board lives on this machine; if they want it durable across machines or shareable, they can `git init` the root later and re-run this skill to upgrade to umbrella mode.

## Step 5 — Wire .gitignore (mode-dependent)

The worktree dir must be ignored wherever it appears. Where "wherever" is depends on mode:

### Mode = single

Add to CWD `.gitignore`:

```
# Claude worktrees (used by /orchestrate) — never commit
.claude/worktrees/
```

Then, based on the visibility chosen in Step 4:
- **Shared**: nothing else.
- **Private**: also add `/.ordna/` and `/tasks/`.
- **Config-only**: also add `/tasks/`.

### Mode = umbrella

Two layers of `.gitignore`:

1. **Umbrella root `.gitignore`** — same as `single` (worktree exclusion + visibility ignores for `.ordna/` and `tasks/`).
2. **Each subrepo's `.gitignore`** — add `.claude/worktrees/` to every nested repo discovered in Step 2. The orchestrate skill creates worktrees inside the subrepo that owns the task, so each subrepo needs its own exclusion. If the line is already present, skip it (idempotent).

### Mode = non-git-root

No root `.gitignore` (root is not a repo). Only the subrepo-level wiring:

- Add `.claude/worktrees/` to every subrepo's `.gitignore`.

If a `.gitignore` doesn't yet exist in a subrepo, create one with just that line.

## Step 6 — Configure the reviewer roster

`/orchestrate` runs a configurable reviewer pipeline on each task (and on each PR in PR-review sub-mode). The roster is a project-level decision — different teams use different reviewers — so it's persisted to `.ordna/orchestrate.yaml` rather than re-asked every session.

### 6.1 Detect what's available

Inspect the current machine for likely reviewer candidates. The right way to do this depends on your agent's tool vocabulary, but the idea is: probe for known coding-agent CLIs and report what's on PATH. Examples worth checking (skip any that don't apply):

```bash
which codex 2>/dev/null      # Codex CLI
which claude 2>/dev/null     # Claude Code CLI (one-shot mode via `claude -p`)
which gemini 2>/dev/null     # Gemini CLI, if installed
# ...add others as relevant for your environment
```

The point isn't to enumerate every possible reviewer — it's to surface the candidates the user already has so they don't have to type paths. Keep the detected list short; the user picks from it.

### 6.2 Ask how many reviewers per task

```
How many reviewer slots do you want per task?
  1 — single-reviewer pipeline (cheaper, faster, less coverage)
  2 — dual-reviewer pipeline (recommended — independence catches more)
  3+ — high-coverage (specialised roles like security, perf, design)
```

Default suggestion: `2` if at least two coding-agent CLIs are detected, otherwise `1`. The orchestrator skill assumes the dual-reviewer pattern by default but degrades cleanly to single-reviewer when only one slot is configured.

### 6.3 Assign a vendor + role to each slot

For each slot `1..N`, ask:

1. **Which vendor / CLI?** Pick from the detected list, or let the user type a custom command.
2. **What role does this slot cover?** Suggested role vocabulary: `strict-correctness` (edge cases, contract drift, security math), `design-fit` (conventions, surrounding-code context, naming), `security` (auth, input validation, secrets), `perf` (hot paths, allocations, query plans). Free-form — the role string is just used to slant the prompt the orchestrator writes for that slot.

Pair complementary roles where you can. Two reviewers with the same role waste tokens — they'll catch the same things. The whole point of the multi-slot model is independent blindspots.

**When presenting options to the user**, deprioritise pairings that re-use the same vendor across slots if other vendors are available. Showing "codex / design-fit" as a slot-2 option when slot-1 is already "codex / strict-correctness" is noise — the user almost certainly wants a different vendor in slot 2 to get the independent-blindspot benefit. Use the same-vendor option only as a fallback for users with one CLI installed.

**Batching note for agents using AskUserQuestion-style tools with a per-batch question cap**: Step 6 fans out to `2 + N` questions (slot count + N slot-detail questions + parallel/sequential). For `N ≤ 2` (so 4 total), it fits in one batch. For `N ≥ 3`, split across multiple batches — typically one batch for `slot count + parallel/sequential + slot 1`, then a follow-up batch for slots 2..N. Don't try to cram more than the tool allows; the split is cheap.

### 6.4 Parallel or sequential

```
Run reviewer slots in parallel or sequentially?
  parallel — independent reviews, ~N× wall clock, ~N× tokens (recommended)
  sequential — each reviewer sees prior outputs, lower tokens, anchoring risk
```

Default: `parallel`. Independence > throughput for review quality (the orchestrator skill explains why). Pick sequential only if rate limits or budget force the choice.

### 6.5 Write `.ordna/orchestrate.yaml`

The structure is the same regardless of how many slots — one entry per slot in the `reviewers:` array:

```yaml
# .ordna/orchestrate.yaml
reviewers:
  - name: slot-1
    cmd: "codex exec --skip-git-repo-check -"   # vendor + invocation the user picked
    stdin: true                                 # prompt arrives on stdin (the trailing "-" tells codex to read stdin)
    role: strict-correctness
  - name: slot-2
    cmd: "claude -p"
    stdin: false                                # prompt is appended as the final argv (claude -p "...prompt...")
    role: design-fit
  # add a third entry if the user picked 3 slots, etc.
parallel: true
```

Notes on the shape:
- `cmd` is the literal invocation. The orchestrator runs it as a subprocess; how it delivers the prompt depends on `stdin:`.
- `stdin:` (boolean, optional, defaults to `true`) — when `true`, the orchestrator writes the prompt to the reviewer's stdin and lets `cmd` run as-is. When `false`, the orchestrator appends the prompt as the final positional argument (e.g. `claude -p "<prompt>"`). Set this once at config time; the orchestrator never has to guess at runtime.
- `role` is a short string used to slant the per-task prompt. Free-form — the suggested vocabulary in 6.3 is a starting point, not a fixed list.
- `name` is just a label that shows up in logs and task-body annotations. `slot-1` / `slot-2` is fine; `codex-correctness` / `claude-design` is also fine — whatever helps the user read the eventual review output.
- Omitting the file entirely means `/orchestrate` falls back to **inline single-reviewer mode**: it spawns one in-process review pass using the orchestrator agent's own sub-agent primitive (e.g. Claude Code's `Agent` tool, Codex CLI's `codex exec` from within the same session). The role for that pass defaults to `strict-correctness`. This degraded mode loses the independent-blindspots benefit but still catches obvious bugs; it's the right default when the user has no secondary coding-agent CLI installed.

### 6.6 Visibility

This file follows the same Shared / Private / Config-only choice from Step 4:
- **Shared / Config-only**: commit it (it captures the team's review convention)
- **Private**: leave it untracked

In non-git-root mode the file lives on disk only, like everything else at the board root.

## Step 7 — Start the kanban web UI

```bash
ordna web --port 7420 &
```

Tell the user the URL: **http://localhost:7420**. The UI shows columns in the order defined in `config.yaml`, so they'll see all 5. The same URL serves whichever directory you launched it from — one ordna board per launch, regardless of mode.

## Step 8 — Commit the setup (mode-dependent)

### Mode = single

Stage based on Step 4 visibility:

- **Shared**: `git add .ordna/ .gitignore` (and `tasks/` if created — `.ordna/` includes `orchestrate.yaml` from Step 6 if you wrote it)
- **Config-only**: `git add .ordna/config.yaml .ordna/orchestrate.yaml .gitignore` (drop `orchestrate.yaml` if user kept it private)
- **Private**: `git add .gitignore`

Then:

```bash
git commit -m "chore(ordna): initialise board for /orchestrate workflow"
```

### Mode = umbrella

Two commits — one in the umbrella for the board, one per subrepo for the worktree gitignore update:

1. Umbrella: same staging as `single`, then commit at umbrella root.
2. Each subrepo touched in Step 5.2: `git -C <subrepo> add .gitignore && git -C <subrepo> commit -m "chore: ignore .claude/worktrees/"`. Skip subrepos where the line was already present or where the subrepo has uncommitted user work you'd be bundling in.

### Mode = non-git-root

Skip the root commit entirely (no git there). Still commit the subrepo `.gitignore` additions per Step 5.3, with the same caution about uncommitted user work.

Tracking `.ordna/config.yaml` (and `.ordna/orchestrate.yaml`) in git (single + umbrella, shared / config-only modes) makes the column layout AND the reviewer roster durable across machines + collaborators.

## Step 9 — Hand off

Tell the user:
- Which mode was detected ("Setup as single / umbrella / non-git-root")
- Which subrepos are in scope (for umbrella/non-git-root)
- Visibility choice (where applicable)
- Reviewer roster: which reviewers were configured, in what roles, parallel or sequential
- Web UI: http://localhost:7420
- "When you're ready, run `/orchestrate <task description>` to plan + delegate work"
- For PR-review tasks (`/orchestrate Review these PRs: ...`), orchestrate detects the sub-mode and runs BOTH configured reviewers against each PR's diff in parallel, then posts a single reconciled review comment to the tracker. See `orchestrate.md` "PR-review sub-mode" for details.
- In multi-repo modes: remind them every task needs `**Target repo:** <subdir>` at the top of its body

## Notes

- This skill is idempotent — running it twice is harmless (`ordna init` no-ops if already initialised, gitignore line additions are conditional, mode detection is re-run from scratch, reviewer-config rewrites are explicit). Don't fail if any single step is already done.
- Do NOT create example tasks. `/orchestrate` plans tasks based on the user's actual request.
- If the project already has a `tasks/` dir from a different tool, ask the user before overwriting.
- If running this in a worktree (rather than the main checkout), refuse and tell the user to switch to the main repo first.
- If the user's umbrella mode subrepos have submodules / gitlinks / sparse checkouts, surface that so they can decide whether each is a real "target repo" before /orchestrate tries to write worktrees into it.
- The reviewer roster is just text — users can hand-edit `.ordna/orchestrate.yaml` later (swap CLIs, add a third reviewer, flip parallel→sequential) without re-running this skill.

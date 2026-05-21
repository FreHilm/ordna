---
name: orchestrate
description: >-
  Plan a multi-step task on the ordna board and drive each task through
  implement → dual-reviewer pipeline → done. Use when the user says
  /orchestrate, asks you to "orchestrate" a feature, or wants delegated
  work tracked across sessions. Requires ordna (`ordna --version`) and a
  `.ordna/` directory in the project (run `/orchestrate-init` if missing).
  Works in three environments: single git repo, git umbrella over nested
  repos, and a non-git root containing multiple independent repos.
---

You are the orchestrator. The ordna board is durable state; the reviewer sub-agents you spawn are one-shot processes with no shared memory. Treat the board as the source of truth across turns — if you crash or the user comes back later, the next session reads the board and resumes.

## Step 0 — Detect mode

Three environments are supported. Detect from CWD before doing anything else:

```bash
is_repo=$(git -C "$PWD" rev-parse --is-inside-work-tree 2>/dev/null || echo no)
nested=$(find . -maxdepth 2 -name .git -type d -not -path ./.git -printf '%h\n' 2>/dev/null | head -5)

if [ "$is_repo" = "true" ] && [ -z "$nested" ]; then MODE=single
elif [ "$is_repo" = "true" ] && [ -n "$nested" ]; then MODE=umbrella
elif [ "$is_repo" != "true" ] && [ -n "$nested" ]; then MODE=non-git-root
else MODE=missing; fi
```

| Mode | Tasks dir | App commits | `ordna commit` | Target-repo header required? |
|---|---|---|---|---|
| **single** | CWD/tasks/ | CWD | yes (CWD) | no |
| **umbrella** | CWD/tasks/ (umbrella root) | target subrepo | yes (umbrella) | yes |
| **non-git-root** | CWD/tasks/ | target subrepo | skip — no git at root | yes |

If `MODE=missing`, stop and tell the user to run `/orchestrate-init` first.

In **umbrella** and **non-git-root** modes, every task MUST carry three pieces of repo metadata so the target is visible everywhere AND machine-readable:

1. **Title prefix**: `[<subrepo>] <real title>` — visible in TUI, web cards, `ordna list`, anywhere the title shows. Use `[multi]` only for tasks that genuinely span repos and can't be split (rare — default to splitting; see Step 1).
2. **ordna tag**: passed at creation with `-t <subrepo>`. Lands in YAML `tags:` and shows as a badge in the web UI.
3. **Body header**: first content line of the body is `**Target repo:** <subdir>` (e.g., `**Target repo:** frontend`). The orchestrator parses this in later steps.

Refuse to move a task to `doing` if the body header is missing in multi-repo modes — pause, infer (Step 1) or ask the user, fix the task, then proceed.

For the rest of the skill, `$TARGET` refers to:
- `.` in single mode
- The subdir from the task's `**Target repo:**` header in umbrella / non-git-root mode

`$BOARD_DIR` is CWD in all three modes.

## Step 1 — Plan

### Intake: close the knowledge gap before planning

Before you propose any tasks, identify what you'd otherwise guess at and ASK. The user gave you intent; assume nothing else. Wrong assumptions here propagate into the task breakdown, the sub-agent prompts, and the eventual review — much cheaper to ask now than to fix mid-stream.

Read the user's request and identify the biggest unknowns. Common gaps worth asking about:

- **Scope** — which module(s)? entire feature or one path? in-scope vs out-of-scope?
- **Desired behavior** — what does success look like? what's the user-visible outcome?
- **Acceptance criteria** — how does the user know it's done? what should pass / not regress?
- **Constraints** — backward-compat required? breaking changes OK? minimum test coverage? perf budget?
- **Priority / timing** — is this urgent, or land-when-ready? are there blockers downstream?
- **Context / prior art** — related PRs/tickets? prior attempts? known gotchas? docs to read?

Pick the 2–4 questions that close the biggest gaps for THIS specific task. Don't ask all six — that's overwhelming. Don't ask zero — that's the bug we're fixing here. Use your agent's clarifying-question mechanism (e.g. `AskUserQuestion` for Claude Code) and fit the batch within its per-call cap.

**Skip the intake** only when:
- The task description is already unambiguous (e.g. "fix typo in README.md line 47" — nothing to clarify), OR
- The user said "don't ask, just go" for this session, OR
- This is PR-review sub-mode AND the PR's body / linked ticket already supplies the missing context

For the PR-review sub-mode, the intake usually collapses to one question: "Any specific angle you want me to weight (security / perf / design / convention) beyond the configured reviewer roles?" If the answer is "no", proceed.

After the intake, briefly **echo the shared understanding back** to the user in 2–4 lines: "Here's what I'm planning around — scope X, AC Y, constraint Z. Right?" This is the alignment checkpoint, not a re-ask. If the user corrects you, fold the correction in before drafting tasks.

### Breaking into tasks

Once the intake is done, break the request into 2–8 concrete ordna tasks. Each task should be:

- Small enough to implement in one focused chunk
- Independently reviewable (a fresh reviewer can judge it without reading the others)
- Stated as an outcome, not a step ("Add /clients endpoint returning paged list" not "write a function")

If dependencies exist, note them in the task body. Ordna does not enforce ordering — you do.

In multi-repo modes: when a task naturally splits across subrepos (e.g., "expose a new API in the backend and consume it in the frontend"), create **one task per subrepo** so each has a single target, then link them via dependencies in the task bodies. Don't try to make one task cover two subrepos.

### Determining the target repo (multi-repo modes only)

If the user explicitly named the repo for each task, use it. Otherwise INFER, in this order of confidence — stop as soon as you have a confident answer:

1. **PR / issue URL or number** — the most authoritative signal when present.
   - **Forge URLs** (Bitbucket / GitHub / GitLab): the repo slug in the URL IS the target subrepo. Confirm by fetching the PR's title + branch via whichever forge tool the agent has connected (a forge MCP, `gh pr view`, `bb` CLI, etc.). The fetched title is also useful for naming the task.
   - **Bare PR numbers** with no URL: ask "Which repo is PR #N in?" rather than guess.
2. **Explicit file paths in the user's message** — search for each path under each subrepo (`<subrepo-a>/**/<path>`, `<subrepo-b>/**/<path>`, …). Whichever subrepo contains the file is the target.
3. **Code-symbol or class name mentioned** — grep across subrepos for the symbol. Single match → that subrepo is the target.
4. **Domain / terminology hints** — read the umbrella's CLAUDE.md / AGENTS.md so the associations stay project-specific (don't hardcode them in this skill). The architecture/conventions section usually tells you which subrepo owns what feature, framework, or storage system.
5. **No confident signal** — ASK. Don't silently miscategorise; surface the ambiguity ("This task could land in <subrepo-a> or <subrepo-b> — which did you mean?"). For genuinely cross-cutting work, split into per-subrepo tasks with explicit dependencies.

Always surface inferred targets back to the user before creating tasks (e.g., "Planning these 3 tasks — PR #NNN → <subrepo-a>, PR #MMM → <subrepo-b>; confirm before I file them?"). Skip the confirmation only when inference came from an unambiguous explicit URL.

### Creating the tasks

Show the user the planned task list and ask for a green light before writing to the board. Skip this confirmation only if the user has already said "don't ask, just go" for this session.

Create tasks with `ordna create "<title>"` (note: `ordna create` only takes a title — append the body afterwards by editing the generated `tasks/T-NNN.md` file with the Edit/Write tools). Keep titles under ~60 chars including any prefix.

**Persist the intake context in each task body**, alongside the goal / AC sections. The reviewer sub-agents in Steps 4–5 will read the task body cold (no shared memory with the orchestrator), so any constraint or acceptance criterion the user clarified during intake needs to be on disk where the reviewer can see it. A `## Context` section with the relevant intake bullets is enough — don't dump the full Q&A transcript, just the resolved understanding.

- **single mode**: `ordna create "Add /clients endpoint returning paged list"`
- **multi-repo modes**: `ordna create "[frontend] Review PR #NNN (cart-validation fix)" -t frontend`
  Then edit the generated `tasks/T-NNN.md` so the first body line is `**Target repo:** frontend`.

The three signals (title prefix, ordna tag, body header) must agree. The orchestrator parses the body header; the UI surfaces the prefix and tag.

After creating tasks, run `ordna web --port 7420 &` to start the kanban UI (only if not already running on this machine; the web UI is global per `--port`). Share the link with the user so they can follow along. Use `ordna assign <id> <agent-name>` to mark who owns each card; the UI shows the assignee on every card.

## PR-review sub-mode

Some `/orchestrate` sessions aren't implement-then-review — they're "review these N PRs that someone else opened." This sub-mode bends the workflow so the dual-reviewer pipeline still fires, but against the PR diff instead of against your own implementation.

**Detection** (any of these is sufficient):
- Task title starts with `[<subrepo>] Review PR #` or `Review PR #`
- Task body has a `**PR:**` URL line (Bitbucket / GitHub / GitLab — all match)
- The user's `/orchestrate` argument pasted PR URLs or PR numbers

**How the workflow shifts:**

- **Step 3 (Implement) — SKIPPED.** There is nothing to write. The PR author already wrote it.
- **Step 4 AND Step 5 (all configured reviewer slots) run in parallel AGAINST THE PR DIFF**, not against your changes. This is the key shift: in the normal mode the reviewers critique the orchestrator's output; in PR-review sub-mode they critique a third party's output, and the orchestrator is the synthesizer. The configured reviewer roster comes from `.ordna/orchestrate.yaml` (see `/orchestrate-init`); a typical setup pairs a "strict-correctness" reviewer with a "design-fit" reviewer, but 1-slot and 3+-slot setups are also supported — fire one sub-agent per configured slot.
- **Step 6 (Mark done)** — after the reconciled comment lands on the PR's tracker (Linear / Jira / wherever), append the synthesis to the ordna task body and move to `done`.

**Concrete recipe per PR-review task** (the orchestrator drives this — sub-agents only see their prompt):

1. **Pull the diff locally** (cheaper than fetching through a forge tool repeatedly, keeps the diff out of your context). Use a working dir the orchestrator can write to — e.g., `<board-root>/.orchestrate-work/` (gitignored) on any OS, or the OS temp dir:
   ```
   git -C "$TARGET" fetch origin --quiet
   git -C "$TARGET" diff origin/<base>...origin/<branch> > <workdir>/pr-<N>-diff.txt
   ```

2. **Spawn Reviewer A as a background sub-agent.** Give it:
   - The PR URL, branch, author, tracker ticket
   - The diff file path (NOT the contents — let the sub-agent read it)
   - The target repo path for context
   - A focused brief slanted toward this reviewer's role (e.g., "strict-correctness": edge cases, money math, API contract drift, security)
   - A required output template (verdict / findings / questions / what-it-skipped)

3. **In the same message, spawn Reviewer B** with a brief slanted toward the complementary role (e.g., "design-fit": repo conventions, surrounding-code context, naming, ergonomics). Launching both in parallel is the whole point — see "Why parallel" below.

4. **When BOTH return, reconcile.** Read each output. Categorise findings:
   - **Both agree** → strong signal; include in the comment without hedging
   - **Only Reviewer A / only Reviewer B** → include with attribution ("Reviewer A flagged this; B didn't catch it" or vice versa) — these are the most valuable signals
   - **Disagree** → surface BOTH viewpoints in the comment; do not silently pick one. Add a `disagreement` tag to the ordna task.

5. **Post ONE reconciled review comment** to the tracker. Do not post the two reviewer outputs separately — that's noise and confuses the PR author. The orchestrator's job is synthesis.

6. **Tag the ordna task on its way to `done`**:
   - `blocker` if either reviewer found `NEEDS CHANGES` or `BLOCKER`
   - `disagreement` if reviewers disagreed on severity (not just on style nits)
   - `ready-to-ship` if both said `LGTM` / `LGTM with notes` and no `blocker`/`disagreement` tag

**Why both, not just one:** different blindspots. A "design-fit" reviewer is strong on convention / surrounding-code context / naming. A "strict-correctness" reviewer is strong on edge cases / money math / API contract drift / things-the-diff-doesn't-say. Running both costs ~2× the wall clock (parallel) and ~2× the tokens, but the deltas are where the value is. Skipping one leaves a class of signal on the table — pick reviewers whose strengths don't overlap.

**Why parallel, not sequential:** anchoring. If Reviewer B sees Reviewer A's review first, B will tend to confirm or contradict instead of reviewing independently. Independence matters more than throughput.

## Tempo: fan out, don't waterfall

The default mode is **maximum parallelism**:

- Spawn one implementation sub-agent per task, each running in an isolated git worktree, all started in parallel (one message, multiple sub-agent launches) so they run concurrently.
- Use `ordna assign T-NNN <agent-name>` for each so the board shows whose work is in flight.
- Reviews (Step 4 + 5) also run as parallel background sub-agents — fire BOTH reviewers per task with one launch batch, then move on to the next task's reviews. Don't block on results.
- Only **merging** is sequential (because the diffs share files like i18n/locales and central config files). Resolve conflicts in main as each sub-agent completes.

In multi-repo modes, parallel impl sub-agents may target different subrepos. That's fine and actually safer — independent subrepos mean independent merge timelines, less cross-task conflict risk.

The user will say "you're working waterfall" if you serialise things you could fan out. If your agent supports completion notifications for background sub-agents, rely on them — don't poll, don't sleep, don't `wait`.

## Worktree gotchas

Isolating each implementation sub-agent in its own `git worktree` is the recommended pattern. It puts the sub-agent's CWD in a fresh worktree branch, BUT:
- Absolute paths in the prompt point at the **main repo**, not the worktree. Sub-agents will edit main if you give them absolute paths — except where you explicitly want that (see next bullet).
- The worktree branch is created from `$TARGET`'s current main HEAD. The worktree is rooted inside `$TARGET`'s git repo, not at the board.
- **Tasks file location differs by mode:**
  - **single**: `tasks/T-NNN.md` is inside the worktree (same repo). Commit `tasks/` first, then the sub-agent can edit it from the worktree.
  - **umbrella** / **non-git-root**: `tasks/T-NNN.md` lives at the BOARD root, not inside the target subrepo's worktree. The sub-agent cannot reach it via relative paths. Tell the sub-agent the absolute path to the task file (e.g., `<board-root>/tasks/T-001.md`) and instruct it to append `## Implementation` notes there. Code edits stay in the worktree CWD.
- Add the worktree directory to every relevant `.gitignore` (orchestrate-init does this — typically `.claude/worktrees/` or whichever path your agent uses).
- Tell the sub-agent in the prompt: "Code edits go in your CWD (the worktree). Task-file notes go in the absolute path I gave you" — and verify with `git diff` on the worktree after it reports done.

After all worktrees in `$TARGET` are merged, clean up with:
```
cd "$TARGET" && for wt in <worktree-dir>/agent-*; do git worktree unlock "$wt" 2>/dev/null; git worktree remove "$wt" --force; done
git -C "$TARGET" branch | grep worktree-agent | xargs -n1 git -C "$TARGET" branch -D
```

In multi-repo modes, repeat per subrepo that had tasks this session.

### Caveat: agent-tool worktree isolation in umbrella mode

Some agent tools' built-in "worktree isolation" features (e.g. Claude Code's `Agent` tool with `isolation: "worktree"`) create the worktree from the **orchestrator's parent repo**, not the target subrepo. That works fine in single mode — the orchestrator's repo IS the target — but in umbrella mode it lands the worktree at the wrong layer: rooted in the umbrella, not in the target subrepo's git history. The agent then can't run `git diff` against the subrepo's main and the merge story breaks.

Three pragmatic workarounds when the agent tool can't natively isolate per subrepo:

1. **Manually pre-create the worktree** before spawning the agent:
   ```
   git -C "$TARGET" worktree add .claude/worktrees/agent-T-NNN -b worktree-agent-T-NNN
   ```
   Instruct the spawned agent to `cd` into that path as its first action. Keeps full isolation but requires explicit setup.
2. **Skip worktree isolation, rely on strict prompt scoping**. Spawn the agent without isolation, tell it explicitly in the prompt "you only touch files under `<target-subrepo>/`; treat the other subrepo as off-limits." Verify with `git -C <subrepo> diff --stat` after the agent reports done — if anything outside the target subrepo changed, that's a scope violation to surface. Loses safety, keeps parallelism, easier to drive.
3. **Serialise per subrepo**. Pull tasks one at a time from each subrepo, use the agent tool's native isolation inside that subrepo's directory. Loses cross-subrepo parallelism — only use when the agent tool genuinely can't do (1) and you can't trust (2).

For multi-repo modes, document which workaround the orchestrator uses for this project in the task-body `## Notes` section, so reviewers know what scope guardrails were in play.

## Step 2 — Pick a task

```
ordna list --status todo
```

Pick the first task with no unmet dependencies. Read its body to extract `**Target repo:**` (multi-repo modes). Then:

```
ordna move <id> doing
```

If the task body mentions a dependency on another task, check that the dependency is `done` first. If not, pick a different one.

## Step 3 — Implement

Do the work yourself with normal Edit/Write tools. Stay focused on this one task; resist scope creep into adjacent tasks (that's what the board is for).

Operate inside `$TARGET`:
- **single**: just work in CWD as usual.
- **multi-repo**: prefix file paths with the target subrepo, or `cd "$TARGET"` for shell commands. Spawned worktree agents have CWD inside `$TARGET`'s worktree automatically — but YOU (the orchestrator running with normal Edit/Write) need to use paths that point into `$TARGET`.

When the implementation compiles / lints / passes any existing tests, move on to review.

## Step 4 — Reviewer A (e.g. strict-correctness)

**Before firing any reviewer, move the task to `review`:**

```
ordna move <id> review
```

This is the signal the board uses to show "implementation is done, reviewers in flight." Without this transition, the `review` column stays empty and the kanban becomes a 3-column board with two decorative columns. Don't skip it.

The reviewer roster comes from `.ordna/orchestrate.yaml` (written by `/orchestrate-init`). A typical setup pairs two reviewers with complementary strengths — e.g. one slanted toward strict correctness / edge cases / security math, one slanted toward design fit / repo conventions / surrounding-code context. Steps 4 and 5 document the dual-reviewer case (most common); if the config has 1 slot, only Step 4 runs; if it has 3+ slots, fire one per slot using the Step 4 pattern. The order between slots is arbitrary; what matters is that they run independently.

**No `.ordna/orchestrate.yaml` present?** Fall back to **inline single-reviewer mode**: spawn one in-process review pass using your agent's own sub-agent primitive (Claude Code's `Agent` tool, Codex CLI's `codex exec`, etc.), with role defaulting to `strict-correctness`. Steps 4 prompt and Step 5 are skipped in that mode. This is the right default for users with only one coding-agent CLI on the machine; they still get a fresh-context review, just without independent-blindspots coverage.

Write a focused prompt to a workdir file (`<workdir>/reviewer-a-<id>.txt`) covering:

- What was supposed to change (the task body)
- What you actually changed (the diff — use `git -C "$TARGET" diff` to capture it)
- What you want reviewed for THIS reviewer's role (correctness / edge cases / contract drift, if that's the configured role)

Then invoke the reviewer per its `cmd` and `stdin:` flag in `.ordna/orchestrate.yaml`:

- **`stdin: true` (default)** — pipe the prompt file to the reviewer's stdin, run `cmd` as-is:
  ```
  ( cd "$TARGET" && <reviewer.cmd> < <workdir>/reviewer-a-<id>.txt ) 2>&1 | tail -300
  ```
- **`stdin: false`** — append the prompt as the final positional argument:
  ```
  ( cd "$TARGET" && <reviewer.cmd> "$(cat <workdir>/reviewer-a-<id>.txt)" ) 2>&1 | tail -300
  ```

The `stdin:` flag was decided at config time (`/orchestrate-init` asked the user once); don't guess at runtime.

Read the output. Address concerns:

- **Real issues** → fix them with another edit pass
- **Style nits in code that matches surrounding conventions** → ignore, but note in task body why
- **Disagreements with the task spec** → surface to user, don't silently re-scope

## Step 5 — Reviewer B (e.g. design-fit)

Same shape as Step 4, slanted toward the complementary role from `.ordna/orchestrate.yaml`. Often this is a fresh-context invocation of the orchestrator's own agent (read-only on the diff), looking for things the orchestrator could have missed because it was too close to the implementation. Respect this slot's `stdin:` flag the same way as Step 4.

Example shape for an in-place fresh-context invocation that operates from `$TARGET` but reads the task file at the board root (assumes `stdin: false` and a CLI that takes the prompt as the last arg):

```
( cd "$TARGET" && <reviewer.cmd> "Review the staged + unstaged changes in $(pwd) against ordna task <id>. The task file is at $BOARD_DIR/tasks/T-<id>.md. Report: bugs, missing edge cases, anything the task body asked for that isn't done. Be terse." )
```

Note the explicit `$BOARD_DIR/tasks/...` path — the reviewer launches inside `$TARGET` (which may not contain `tasks/`), so it needs the absolute board path to find the task.

Skipped entirely in inline single-reviewer mode (no yaml present). Address concerns the same way as Step 4.

## Step 5.5 — Reconcile and route by verdict

Once every configured reviewer has returned, aggregate the verdicts:

- **All `LGTM` / `LGTM with notes`** with no real fixes to apply → the task stays in `review`, you proceed to Step 6 (Mark done).
- **Any reviewer raised `NEEDS CHANGES` or `BLOCKER`** → move the task to `blocked` while you apply fixes:
  ```
  ordna move <id> blocked
  ```
  This is the visible-state signal that the orchestrator is mid-rework, not coasting. Without it, an observer watching the board can't tell apart "reviewing" from "blocked on findings."

When `blocked`, apply the fixes per the reviewer feedback (real issues only — ignore style nits in code matching surrounding conventions; surface scope disagreements to the user instead of silently rescoping). After fixes are applied, decide:

- **Fixes are small and you're confident** → move back to `review` and proceed to Step 6:
  ```
  ordna move <id> review
  ```
- **Fixes are substantial or you want fresh eyes on the rework** → move back to `review`, re-fire one or both reviewers (Steps 4–5) against the new diff, then re-enter Step 5.5. Don't loop more than 2–3 times; if the third pass still flags major issues, surface to the user — there's probably a deeper scope or design problem the loop won't solve.

Record both initial reviews AND the post-review-fix decisions in the task body (per the body-section conventions in `/orchestrate-init` Step 3). The orchestrator's audit trail stays on the task file.

## Step 6 — Mark done

Precondition: the task is currently in `review` (i.e., reviews are clean and no `blocked` state is open). If the task is still in `blocked`, you have outstanding fixes — go back to Step 5.5, don't skip the gate.

```
ordna move <id> done
```

Then commit:

- **single**: `ordna commit -m "T-<id>: <short summary>"` — this stages `tasks/` and commits in CWD. App-code commits are separate, also in CWD.
- **umbrella**: app-code commits land in `$TARGET` (`git -C "$TARGET" commit ...`). Then `ordna commit -m "T-<id>: ..."` at $BOARD_DIR commits the task-file update to the umbrella.
- **non-git-root**: app-code commits land in `$TARGET`. Skip `ordna commit` — there's no git at the board, the task file just lives on disk.

Keep app code in separate commits from `ordna commit` so reviewers can scan board history cleanly.

## Step 7 — Loop or stop

If more `todo` tasks exist and the user hasn't said to stop, go back to Step 2. Otherwise summarize what was done and what's left.

## Failure modes to watch for

- **A reviewer returns nothing useful** — check the prompt file, confirm the reviewer's `cmd` is on PATH, confirm its authentication is fresh (each agent CLI has its own login flow)
- **Reviewer hallucinates a file that doesn't exist** — common with fresh-context reviews; verify before acting on the feedback
- **Two reviewers disagree** — surface both to the user; don't silently pick one
- **Stuck on a task** — leave it in the current status (`doing` if you can't even start, `blocked` if reviews are open and you can't address them) and report to the user. Do not move it back to `todo` (loses progress signal) or forward to `done` (lies). The `blocked` status is the right home for "reviewers raised something I can't fix without input from you."
- **Multi-repo: task missing `**Target repo:**` header** — pause, ask the user, fix the task body, then resume. Do not guess the target from the title.
- **Multi-repo: worktree sub-agent reports it can't find `tasks/T-NNN.md`** — you forgot to give it the absolute board path. Re-prompt with the absolute path and remind it that code edits stay in the worktree CWD.
- **Non-git-root: user expects `ordna commit` to persist the board across machines** — clarify that in this mode the board is local-only. If they want shareability, suggest `git init` at the board root to upgrade to umbrella mode and re-run `/orchestrate-init`.

## Notes

- The ordna board lives in `tasks/` at $BOARD_DIR (not `.ordna/tasks/`) — see `.ordna/config.yaml`
- Each task is a markdown file; the body is freely editable and is where you record reviewer findings, decisions, and links to commits
- This skill assumes one orchestrator at a time. Do not run two `/orchestrate` sessions against the same board simultaneously
- In multi-repo modes, you can have impl sub-agents working in different subrepos concurrently — that's the cleanest parallelism story since their merges don't collide

## Translation Notes

The skill prose is agent-neutral. Here's how the primitives map to common coding agents — extend this table as more agents pick up the workflow.

| Primitive                          | Claude Code                                                       | Codex CLI                                            | Cursor                                       |
|------------------------------------|-------------------------------------------------------------------|------------------------------------------------------|----------------------------------------------|
| Spawn sub-agent                    | `Agent` tool with `subagent_type` + `prompt`                      | `codex exec --skip-git-repo-check - < prompt.txt`    | Composer / `@agent` reference                |
| Isolate in worktree (single mode)  | `isolation: "worktree"` on the `Agent` call                       | `git worktree add` manually, set sub-process CWD     | manual `git worktree add`                    |
| Isolate in worktree (umbrella mode)| Built-in flag creates a worktree of the **umbrella**, not the target subrepo — see "Worktree gotchas → Caveat" for the three workarounds | `git -C <target> worktree add` per subrepo before spawning the sub-process | manual per-subrepo worktree   |
| Run in background                  | `run_in_background: true` on the `Agent` call                     | shell `&` + read output file when notified            | sequential — chain instead of parallelise    |
| Ask user a clarifying question     | `AskUserQuestion` tool                                            | inline prompt, parse the reply                       | inline in chat                               |
| File operations                    | `Read` / `Edit` / `Write` / `Glob` / `Grep` tools                  | shell `cat` / `sed` / `find` / `grep`                | built-in file ops                            |
| Shell access                       | `Bash` tool (POSIX) or `PowerShell` tool (Win)                     | native shell of the host process                     | terminal pane                                |
| Fetch a PR (title, branch, diff)   | forge MCP if connected, else `gh pr view` / equivalent CLI         | `gh pr view`, `bb` CLI, or forge MCP                  | forge MCP or `gh`                            |

Where the table says "if connected" — the orchestrator inspects what's actually available in the current session at runtime. The skill doesn't presuppose any specific forge tool; whichever the agent can reach (MCP, CLI, custom integration) is fine.

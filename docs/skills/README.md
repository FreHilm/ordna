# Agent skill recipes

This directory holds **community-contributed workflow recipes** that build on top of Ordna's vendor-neutral [`AGENTS.md`](../../packages/cli/templates/AGENTS.md) baseline. Each file is a self-contained skill an agent can install and follow.

These are docs, not bundled CLI templates. Install one with the existing `ordna skill install --from <raw-url>`:

```bash
ordna skill install \
  --from https://raw.githubusercontent.com/FreHilm/ordna/main/docs/skills/orchestrate.md \
  --out .claude/commands/orchestrate.md
```

(Adjust `--out` to whichever location your agent reads skills from.)

## Conventions

- **Skills here describe workflow primitives** ("spawn a sub-agent in an isolated worktree, fire reviewers in parallel"), not specific agent invocations. Each skill ends with a **Translation Notes** table mapping the primitives to common agents (Claude Code, Codex CLI, Cursor, …) — extend the table as more agents pick up the workflow.
- **Skills opt out of agent-specific assumptions.** They probe the current environment at runtime ("which CLIs are on PATH? which forge tools are connected?") instead of presupposing a specific agent stack.
- **Skills don't change ordna's CLI surface.** Anything that would require a CLI change belongs in an issue / PR against `packages/`, not here.

## Skills

| Skill | What it does | Companion |
|---|---|---|
| [`orchestrate.md`](orchestrate.md) | Plans a multi-step task on the ordna board and drives each task through implement → dual-reviewer pipeline → done. Works in single git repo, git umbrella, and non-git-root modes. | needs `orchestrate-init.md` |
| [`orchestrate-init.md`](orchestrate-init.md) | One-time setup for `/orchestrate` in a new project. Detects the environment mode, expands the status flow to 5 columns, wires `.gitignore`s, and interactively configures a reviewer roster persisted to `.ordna/orchestrate.yaml`. | bootstraps `orchestrate.md` |

## Contributing a new skill

1. Open an issue first to align on scope — workflow skills are a real expansion beyond ordna's "file format + config + CLI" baseline, so a quick check-in saves rework.
2. Keep the skill vendor-neutral. Use primitives in the body; put concrete invocations in a Translation Notes table at the bottom.
3. Probe at runtime instead of presupposing. Any "you must have X installed" should be a detection step the skill runs, not an assumption the prose makes.
4. Add an entry to the Skills table above.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitRunner } from "./git-ref.js";

/**
 * Result of `detectStorageMode`. Three confident outcomes
 * (`file` / `hybrid` / `namespace`) lead to auto-configuration; `ask`
 * needs a user prompt; `default-file` is the "no signals, no git"
 * fallback that runs in file mode without writing a config (the user
 * might `git init` later).
 */
export type DetectedMode =
	| { mode: "file" | "hybrid" | "namespace"; reason: string }
	| { mode: "ask"; reason: string }
	| { mode: "default-file"; reason: string };

/**
 * Thrown when `ensureStorageConfig` detects a git repo with no storage
 * signals and no config — there's no defensible default, so the
 * consumer must prompt the user. The TUI catches this and shows a
 * modal, the web server catches it and serves a setup page, the CLI
 * one-shots prompt on TTY or fail with a clear hint.
 */
export class NeedsModeSelection extends Error {
	constructor(
		public readonly cwd: string,
		public readonly reason: string,
	) {
		super(
			`Ordna needs to know which storage mode to use in ${cwd}. ${reason}`,
		);
		this.name = "NeedsModeSelection";
	}
}

/**
 * Inspect `cwd` for storage signals. Pure detection — never writes,
 * never creates anything. Returns a `DetectedMode` for the caller to
 * act on.
 *
 * Detection order:
 *   1. `refs/ordna/tasks/*` exist → `namespace`
 *   2. `refs/ordna/state` exists → `hybrid`
 *   3. `tasks/*.md` files exist → `file`
 *   4. cwd is a git repo (none of the above) → `ask`
 *   5. else → `default-file`
 *
 * Uses `git for-each-ref` to authoritative-check refs (handles packed
 * refs after `git gc` correctly, where direct filesystem reads of
 * `.git/refs/...` would miss them).
 */
export async function detectStorageMode(cwd: string): Promise<DetectedMode> {
	const isGitRepo = isGitWorkingTree(cwd);

	if (isGitRepo) {
		const git = new GitRunner(cwd);
		const taskRefs = await git.forEachRef("refs/ordna/tasks/*");
		if (taskRefs.length > 0) {
			return {
				mode: "namespace",
				reason: `found ${taskRefs.length} ref(s) under refs/ordna/tasks/`,
			};
		}
		const stateRefs = await git.forEachRef("refs/ordna/state");
		if (stateRefs.length > 0) {
			return { mode: "hybrid", reason: "found refs/ordna/state" };
		}
	}

	// File-mode signal: `tasks/` with at least one `.md` file. Without
	// a loaded config we can only check the default path; non-default
	// `tasksDir` configurations imply a config exists, in which case
	// detection never runs.
	const tasksDir = join(cwd, "tasks");
	if (existsSync(tasksDir)) {
		try {
			const entries = readdirSync(tasksDir, { withFileTypes: true });
			const hasMd = entries.some((e) => e.isFile() && e.name.endsWith(".md"));
			if (hasMd) {
				return { mode: "file", reason: "found tasks/*.md files" };
			}
		} catch {
			// readdirSync error (permissions, etc.) — treat as "no signal."
		}
	}

	if (isGitRepo) {
		return {
			mode: "ask",
			reason: "no storage signals found, but this is a git repo",
		};
	}

	return {
		mode: "default-file",
		reason: "no git, no existing tasks — defaulting to file mode",
	};
}

/**
 * Compose detection + write into one call.
 *
 * - If `ORDNA_STORAGE` is set to a valid mode, return immediately
 *   without writing or detecting. The caller relies on `loadConfig`
 *   honouring the env var.
 * - If `.ordna/config.yaml` already exists, return immediately.
 * - Otherwise run `detectStorageMode` and:
 *   - `file` / `hybrid` / `namespace` → write the config with the
 *     detected storage key
 *   - `ask` → throw `NeedsModeSelection`
 *   - `default-file` → return without writing (let the caller fall
 *     back to in-memory file mode; if the user later `git init`s,
 *     detection re-evaluates from scratch on next run)
 */
export async function ensureStorageConfig(cwd: string): Promise<void> {
	const envMode = readEnvStorageMode();
	if (envMode) {
		// Env var is a runtime override; do not write the config file.
		return;
	}

	if (configFileExists(cwd)) {
		return;
	}

	const detected = await detectStorageMode(cwd);
	switch (detected.mode) {
		case "file":
		case "hybrid":
		case "namespace":
			writeStorageConfig(cwd, detected.mode);
			return;
		case "ask":
			throw new NeedsModeSelection(cwd, detected.reason);
		case "default-file":
			return; // run with in-memory defaults; don't litter
	}
}

/**
 * Write a minimal `.ordna/config.yaml` containing the chosen storage
 * mode. Other config keys are left to the schema defaults so the file
 * doesn't pin values the user hasn't deliberately chosen.
 *
 * Idempotent — overwrites an existing config file. Callers that don't
 * want that should check first (see `ensureStorageConfig`).
 */
export function writeStorageConfig(
	cwd: string,
	storage: "file" | "hybrid" | "namespace",
): void {
	const configDir = join(cwd, ".ordna");
	if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
	const body = `# Ordna config — auto-written from storage detection.\nstorage: ${storage}\n`;
	writeFileSync(join(configDir, "config.yaml"), body, "utf8");
}

/**
 * Read `ORDNA_STORAGE` from the environment, validating against the
 * three known modes. Anything else (including unset / empty) returns
 * `null` so the normal detection path runs.
 *
 * Exported so `config.ts` can apply the same override when reading the
 * YAML — keeps the env-var semantics consistent across the two
 * entrypoints.
 */
export function readEnvStorageMode():
	| "file"
	| "hybrid"
	| "namespace"
	| null {
	const raw = process.env.ORDNA_STORAGE;
	if (raw === "file" || raw === "hybrid" || raw === "namespace") return raw;
	return null;
}

function configFileExists(cwd: string): boolean {
	return existsSync(join(cwd, ".ordna", "config.yaml"));
}

function isGitWorkingTree(cwd: string): boolean {
	// `.git` can be a directory (regular repo), a file (worktree
	// pointing at the main repo's gitdir), or absent. `existsSync` on
	// `<cwd>/.git` covers all three cases — present (any type) means
	// "this is a git checkout."
	return existsSync(join(cwd, ".git"));
}

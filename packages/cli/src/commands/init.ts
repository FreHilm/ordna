import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	detectStorageMode,
	writeStorageConfig,
} from "@frehilm/ordna-core";
import { c } from "../colors.js";
import { promptStorageMode } from "../lib/prompt-mode.js";

export interface InitOptions {
	storage?: "file" | "hybrid" | "namespace";
}

const FILE_MODE_TEMPLATE = `# Ordna config — all keys optional.
storage: file
tasksDir: tasks
schema: ordna
statuses: [todo, doing, done]
idPrefix: T
zeroPaddedIds: 3
webPort: 7420
`;

/**
 * Initialise Ordna in the current directory.
 *
 * - `--storage=file|hybrid|namespace` skips detection entirely and
 *   writes the chosen mode (the chosen mode dictates whether
 *   `tasks/` is created).
 * - Without `--storage`, runs detection. Confident modes auto-write.
 *   On the "ask" branch (git repo, no signals), prompts the user.
 * - If `.ordna/config.yaml` already exists, this is a no-op (preserves
 *   existing behaviour).
 */
export async function runInit(
	options: InitOptions = {},
	cwd: string = process.cwd(),
): Promise<void> {
	const configDir = join(cwd, ".ordna");
	const configFile = join(configDir, "config.yaml");

	if (existsSync(configFile)) {
		console.log(c.dim("Ordna already initialized in this repo."));
		return;
	}

	// Decide storage mode: explicit flag, then detection, then prompt.
	let storage: "file" | "hybrid" | "namespace";
	if (options.storage) {
		storage = options.storage;
	} else {
		const detected = await detectStorageMode(cwd);
		if (detected.mode === "ask") {
			if (process.stdin.isTTY) {
				storage = await promptStorageMode();
			} else {
				console.error(
					c.red(
						"This directory is a git repo with no storage signals, and this isn't an interactive shell.",
					),
				);
				console.error(
					c.dim(
						"  Re-run with `ordna init --storage=file|hybrid|namespace`.",
					),
				);
				process.exit(1);
			}
		} else if (detected.mode === "default-file") {
			storage = "file";
		} else {
			storage = detected.mode;
		}
	}

	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}

	// File mode keeps the full default template (visible defaults are
	// good docs for new users). Hybrid + namespace get the minimal
	// config from `writeStorageConfig` (just the storage key).
	if (storage === "file") {
		writeFileSync(configFile, FILE_MODE_TEMPLATE, "utf8");
		const tasksDir = join(cwd, "tasks");
		if (!existsSync(tasksDir)) {
			mkdirSync(tasksDir, { recursive: true });
		}
	} else {
		writeStorageConfig(cwd, storage);
		if (storage === "hybrid") {
			// Hybrid still uses files; create the tasks/ dir so subsequent
			// `ordna create` calls find a writable location.
			const tasksDir = join(cwd, "tasks");
			if (!existsSync(tasksDir)) {
				mkdirSync(tasksDir, { recursive: true });
			}
		}
	}

	console.log(c.green(`Initialized Ordna (storage: ${c.bold(storage)}).`));
	console.log(c.dim(`  ${configFile}`));
	if (storage !== "namespace") {
		console.log(c.dim(`  ${join(cwd, "tasks")}/`));
	}
}

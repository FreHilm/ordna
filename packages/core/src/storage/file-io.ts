import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OrdnaConfig } from "../config.js";
import { nextId, parseId } from "../ids.js";
import type { SchemaMode } from "../schema.js";

/**
 * Pure file-IO helpers used by `FileBackend` and (in T-031)
 * `HybridBackend`. Knows nothing about Task semantics — operates on
 * raw bytes and paths only. The Task layer lives in
 * `storage/markdown.ts`.
 */

export interface TaskFileEntry {
	filePath: string;
	raw: string;
}

/** Read every `.md` file under `tasksDir`. Returns empty if dir absent. */
export async function listTaskBytes(tasksDir: string): Promise<TaskFileEntry[]> {
	if (!existsSync(tasksDir)) return [];

	const entries = readdirSync(tasksDir, { withFileTypes: true });
	const out: TaskFileEntry[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const filePath = join(tasksDir, entry.name);
		const raw = await readFile(filePath, "utf8");
		out.push({ filePath, raw });
	}
	return out;
}

/** Read a single task file's bytes. Throws if missing — caller decides null vs error. */
export function readTaskBytes(filePath: string): Promise<string> {
	return readFile(filePath, "utf8");
}

/** Write bytes to a task file. Caller ensures the directory exists. */
export function writeTaskBytes(filePath: string, content: string): Promise<void> {
	return writeFile(filePath, content, "utf8");
}

/** Remove a task file. Throws if it doesn't exist. */
export function deleteTaskFile(filePath: string): Promise<void> {
	return unlink(filePath);
}

/** Idempotent `mkdir -p` for the tasks directory. */
export function ensureTasksDir(tasksDir: string): void {
	if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
}

function slugifyTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

/**
 * Compute the filename for a task in the configured schema.
 * - `ordna` schema: `<id>.md` (e.g. `T-001.md`)
 * - `backlog` schema: `task-<n> - <slug>.md` (Backlog.md convention)
 */
export function filenameFor(
	id: string,
	title: string,
	mode: SchemaMode,
	config: OrdnaConfig,
): string {
	if (mode === "backlog") {
		const numeric = parseId(config, id);
		const numericPart = numeric ?? id;
		const slug = slugifyTitle(title) || "task";
		return `task-${numericPart} - ${slug}.md`;
	}
	return `${id}.md`;
}

/**
 * Allocate the next ID by scanning the tasks directory for the highest
 * numeric ID and incrementing. This is the file-backend allocator;
 * hybrid mode replaces this with a git-ref CAS allocator (T-031).
 *
 * Thin re-export of `ids.ts:nextId` so backends have one import surface
 * for storage primitives.
 */
export function nextIdFromScan(config: OrdnaConfig, tasksDir: string): string {
	return nextId(config, tasksDir);
}

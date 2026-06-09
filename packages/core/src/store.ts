import { existsSync } from "node:fs";
import { join } from "node:path";
import { type OrdnaConfig, loadConfig, resolveTasksDir } from "./config.js";
import type { Task, TaskCreateInput, TaskUpdateInput } from "./schema.js";
import {
	type Backend,
	type ListOptions,
	ARCHIVED_STATUS,
	isKnownStatus,
} from "./storage/backend.js";
import { FileBackend } from "./storage/backends/file.js";
import { HybridBackend } from "./storage/backends/hybrid.js";
import { NamespaceBackend } from "./storage/backends/namespace.js";

/**
 * Public context object passed to every store function. The `backend`
 * field carries the storage strategy chosen at `createContext` time;
 * the strategy interface itself is private (not exported from
 * `index.ts`).
 *
 * `backend` is typed as `Backend`, which is unexported, so consumers
 * can read the field but can't declare their own `Backend`-typed
 * variables without importing internals. That's intentional — the
 * field is public for now (future cleanup may hide it behind a
 * method) but the interface stays a TS-internal seam.
 */
export interface StoreContext {
	cwd: string;
	config: OrdnaConfig;
	tasksDir: string;
	backend: Backend;
}

export { ARCHIVED_STATUS, isKnownStatus };

/**
 * @deprecated Use `ListOptions` from the backend layer (not exported).
 *             Kept as the public type name for back-compat with
 *             0.1.x consumers. Same shape.
 */
export type ListTasksOptions = ListOptions;

/**
 * Build a context bound to the active working directory.
 *
 * Stays SYNCHRONOUS. The chosen backend is constructed cheaply (no
 * I/O); the first method call on the backend triggers lazy `init()`
 * internally. This is what lets the IDE that embeds core construct
 * contexts without awaiting.
 *
 * Backend selection is driven by `config.storage`. Combinations that
 * make no sense are rejected eagerly so the user sees a clear error
 * up front rather than a confusing failure deep inside a method call.
 *
 *  - `storage: hybrid` requires a git repository (`.git/` present at
 *    `cwd` or any parent)
 *  - `storage: hybrid` + `schema: backlog` is rejected — the audit-
 *    log model and Backlog's filename conventions are out of scope
 *    for v1 to combine
 *  - `storage: namespace` is reserved for T-032; rejected for now
 */
export function createContext(cwd: string = process.cwd()): StoreContext {
	const config = loadConfig({ cwd });
	const tasksDir = resolveTasksDir(config, cwd);

	if (config.storage === "hybrid") {
		assertGitRepo(cwd, "hybrid");
		if (config.schema === "backlog") {
			throw new Error(
				"ordna: `storage: hybrid` is not supported with `schema: backlog` in v1. Use `schema: ordna`, or stay on `storage: file` if you need Backlog.md compatibility.",
			);
		}
		const backend = new HybridBackend(cwd, config, tasksDir);
		return { cwd, config, tasksDir, backend };
	}

	if (config.storage === "namespace") {
		assertGitRepo(cwd, "namespace");
		if (config.schema === "backlog") {
			throw new Error(
				"ordna: `storage: namespace` is not supported with `schema: backlog`. Backlog's filename convention has no analogue in a ref-only store; use `schema: ordna`, or stay on `storage: file` if you need Backlog.md compatibility.",
			);
		}
		const backend = new NamespaceBackend(cwd, config);
		return { cwd, config, tasksDir, backend };
	}

	const backend = new FileBackend(cwd, config, tasksDir);
	return { cwd, config, tasksDir, backend };
}

function assertGitRepo(cwd: string, mode: "hybrid" | "namespace"): void {
	// Walk up from cwd looking for a `.git/` directory. A bare repo
	// would lack the working tree but still has `.git` as a file
	// pointer or directory; we accept either.
	let dir = cwd;
	for (let i = 0; i < 64; i++) {
		if (existsSync(join(dir, ".git"))) return;
		const parent = join(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		`ordna: \`storage: ${mode}\` requires a git repository. Run \`git init\` in this directory, or switch back to \`storage: file\` in .ordna/config.yaml.`,
	);
}

export async function listTasks(
	ctx: StoreContext = createContext(),
	options: ListOptions = {},
): Promise<Task[]> {
	return ctx.backend.list(options);
}

export async function getTask(
	id: string,
	ctx: StoreContext = createContext(),
): Promise<Task | null> {
	return ctx.backend.get(id);
}

export async function createTask(
	input: TaskCreateInput,
	ctx: StoreContext = createContext(),
): Promise<Task> {
	return ctx.backend.create(input);
}

export async function updateTask(
	id: string,
	patch: TaskUpdateInput,
	ctx: StoreContext = createContext(),
): Promise<Task> {
	if (
		patch.status !== undefined &&
		!isKnownStatus(ctx.config, patch.status)
	) {
		throw new Error(`Status "${patch.status}" is not in configured statuses.`);
	}
	return ctx.backend.update(id, patch);
}

/**
 * Move a task to a new status. The `depends_on` gate stays in core so
 * backends don't have to re-implement Ordna's business rules — the
 * gate fires here, then the actual write is delegated to the backend.
 */
export async function moveTask(
	id: string,
	status: string,
	ctx: StoreContext = createContext(),
): Promise<Task> {
	if (!isKnownStatus(ctx.config, status)) {
		throw new Error(`Status "${status}" is not in configured statuses.`);
	}
	const terminal = ctx.config.statuses[ctx.config.statuses.length - 1];
	if (status === terminal) {
		const task = await ctx.backend.get(id);
		if (!task) throw new Error(`Task ${id} not found.`);
		if (task.depends_on.length > 0) {
			const all = await ctx.backend.list();
			const byId = new Map(all.map((t) => [t.id, t]));
			const unfinished = task.depends_on.filter((dep) => {
				const d = byId.get(dep);
				return !d || d.status !== terminal;
			});
			if (unfinished.length > 0) {
				throw new Error(
					`Cannot move ${id} to ${status}: dependencies not ${terminal}: ${unfinished.join(", ")}`,
				);
			}
		}
	}
	return ctx.backend.update(id, { status });
}

export async function deleteTask(
	id: string,
	ctx: StoreContext = createContext(),
): Promise<void> {
	return ctx.backend.delete(id);
}

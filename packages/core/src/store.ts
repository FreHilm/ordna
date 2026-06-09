import { type OrdnaConfig, loadConfig, resolveTasksDir } from "./config.js";
import type { Task, TaskCreateInput, TaskUpdateInput } from "./schema.js";
import {
	type Backend,
	type ListOptions,
	ARCHIVED_STATUS,
	isKnownStatus,
} from "./storage/backend.js";
import { FileBackend } from "./storage/backends/file.js";

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
 * For now this hard-codes `FileBackend`. Future modes (T-031 hybrid,
 * T-032 namespace) will branch here on `config.storage` once that
 * config key lands.
 */
export function createContext(cwd: string = process.cwd()): StoreContext {
	const config = loadConfig({ cwd });
	const tasksDir = resolveTasksDir(config, cwd);
	const backend = new FileBackend(cwd, config, tasksDir);
	return { cwd, config, tasksDir, backend };
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

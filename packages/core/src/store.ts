import { type OrdnaConfig, loadConfig, resolveTasksDir } from "./config.js";
import type { ListOptions, TaskProvider } from "./provider.js";
import { loadProvider } from "./providers/load.js";
import type { Task, TaskCreateInput, TaskUpdateInput } from "./schema.js";

export interface StoreContext {
	cwd: string;
	config: OrdnaConfig;
	tasksDir: string;
	provider: TaskProvider;
}

export const ARCHIVED_STATUS = "archived";

export function isKnownStatus(config: OrdnaConfig, status: string): boolean {
	if (status === ARCHIVED_STATUS) return true;
	return config.statuses.includes(status);
}

/**
 * @deprecated Use `ListOptions` from `./provider.js` instead. Kept for back-compat.
 */
export type ListTasksOptions = ListOptions;

/**
 * Build a context bound to the active working directory.
 *
 * As of T-022 this is async: the active `TaskProvider` is resolved through
 * `loadProvider`, which dynamically imports external plugin packages
 * (`@frehilm/ordna-<name>`). T-023 wires `provider.init?.()` here so a
 * remote provider can validate auth or fetch a status mapping before any
 * `list()` / `get()` call. Errors from `init` propagate — the caller sees
 * the real failure ("Jira: auth token expired") rather than a deeper
 * mystery later on.
 *
 * One-shot CLI commands (`create`, `list`, `show`, `move`, `assign`,
 * `commit`) do not need to call `disposeContext` afterwards — they exit
 * naturally and the OS reclaims any resources. Only long-lived hosts
 * (`ordna web`, `ordna board`) need an explicit dispose on shutdown.
 */
export async function createContext(
	cwd: string = process.cwd(),
): Promise<StoreContext> {
	const config = loadConfig({ cwd });
	const tasksDir = resolveTasksDir(config, cwd);
	const provider = await loadProvider(config, cwd);
	await provider.init?.();
	return { cwd, config, tasksDir, provider };
}

/**
 * Best-effort cleanup of a context's provider. Used by long-lived hosts
 * (`ordna web`, `ordna board`) on shutdown.
 *
 * Errors from `dispose` are caught and logged to stderr — the user is
 * trying to quit; we shouldn't block them on a watcher's close call. If
 * the provider doesn't implement `dispose`, this is a no-op.
 */
export async function disposeContext(ctx: StoreContext): Promise<void> {
	if (!ctx.provider.dispose) return;
	try {
		await ctx.provider.dispose();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[ordna] provider "${ctx.provider.kind}" dispose failed: ${message}`,
		);
	}
}

export async function listTasks(
	ctx?: StoreContext,
	options: ListOptions = {},
): Promise<Task[]> {
	const c = ctx ?? (await createContext());
	return c.provider.list(options);
}

export async function getTask(
	id: string,
	ctx?: StoreContext,
): Promise<Task | null> {
	const c = ctx ?? (await createContext());
	return c.provider.get(id);
}

export async function createTask(
	input: TaskCreateInput,
	ctx?: StoreContext,
): Promise<Task> {
	const c = ctx ?? (await createContext());
	return c.provider.create(input);
}

export async function updateTask(
	id: string,
	patch: TaskUpdateInput,
	ctx?: StoreContext,
): Promise<Task> {
	const c = ctx ?? (await createContext());
	if (
		patch.status !== undefined &&
		!isKnownStatus(c.config, patch.status)
	) {
		throw new Error(`Status "${patch.status}" is not in configured statuses.`);
	}
	return c.provider.update(id, patch);
}

/**
 * Move a task to a new status. The `depends_on` gate is enforced here
 * (in core) so providers don't have to re-implement the rule. The actual
 * write is delegated to the provider.
 */
export async function moveTask(
	id: string,
	status: string,
	ctx?: StoreContext,
): Promise<Task> {
	const c = ctx ?? (await createContext());
	if (!isKnownStatus(c.config, status)) {
		throw new Error(`Status "${status}" is not in configured statuses.`);
	}
	const terminal = c.config.statuses[c.config.statuses.length - 1];
	if (status === terminal) {
		const task = await c.provider.get(id);
		if (!task) throw new Error(`Task ${id} not found.`);
		if (task.depends_on.length > 0) {
			const all = await c.provider.list();
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
	return c.provider.move(id, status);
}

export async function deleteTask(
	id: string,
	ctx?: StoreContext,
): Promise<void> {
	const c = ctx ?? (await createContext());
	return c.provider.delete(id);
}

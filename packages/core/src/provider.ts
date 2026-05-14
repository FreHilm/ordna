import type { Task, TaskCreateInput, TaskUpdateInput } from "./schema.js";

/**
 * Filters for {@link TaskProvider.list}.
 */
export interface ListOptions {
	status?: string;
	assignee?: string;
	tag?: string;
}

/**
 * An event emitted by {@link TaskProvider.watch} when the underlying task set changes.
 *
 * `removed` carries `id` so all providers (file, jira, linear, …) can describe a removal
 * the same way. The optional `filePath` stays for back-compat with the existing file
 * watcher and is populated only when the source provider is file-backed.
 */
export type TaskEvent =
	| { type: "added"; task: Task }
	| { type: "changed"; task: Task }
	| { type: "removed"; id: string; filePath?: string };

export type TaskEventListener = (event: TaskEvent) => void;

/**
 * Storage backend for Ordna tasks.
 *
 * The built-in {@link FileTaskProvider} reads / writes markdown files in `tasks/`.
 * Plugins (e.g. `@frehilm/ordna-jira`, `@frehilm/ordna-linear`) implement this same
 * interface against a remote tracker, so the TUI / Web / library work unchanged
 * against any backend selected via `provider:` in `.ordna/config.yaml`.
 *
 * Plugins are expected to expose a factory:
 *
 *     export function createProvider(config, cwd): TaskProvider
 *
 * which is called by the dynamic loader in core (T-022).
 */
export interface TaskProvider {
	/**
	 * Identifier used for diagnostics and to populate `Task.remote.provider` on
	 * non-file backends. Common values: `"file"`, `"jira"`, `"linear"`.
	 */
	readonly kind: string;

	/** List tasks matching the optional filters. */
	list(opts?: ListOptions): Promise<Task[]>;

	/** Look up a single task by id. Returns `null` when not found. */
	get(id: string): Promise<Task | null>;

	/** Create a new task. */
	create(input: TaskCreateInput): Promise<Task>;

	/** Patch an existing task. Implementations decide which fields are writable. */
	update(id: string, patch: TaskUpdateInput): Promise<Task>;

	/**
	 * Change a task's status. Core enforces the `depends_on` gate before calling
	 * this; remote providers may also reject the transition based on their own
	 * workflow rules — both errors should surface to the user verbatim.
	 */
	move(id: string, status: string): Promise<Task>;

	/** Remove a task. */
	delete(id: string): Promise<void>;

	/**
	 * Subscribe to changes. The returned function unsubscribes; call it to stop
	 * watching and release any underlying resources.
	 */
	watch(cb: TaskEventListener): () => Promise<void>;

	/**
	 * Optional. File-backed provider: stage and commit the tasks directory.
	 * Remote providers should leave this undefined; core surfaces a clear error
	 * to the user when `ordna commit` is invoked against a provider that doesn't
	 * support it.
	 */
	commit?(message?: string): Promise<void>;

	/** Optional. Called once after construction; do any one-time setup here. */
	init?(): Promise<void>;

	/** Optional. Called once before disposal; close watchers, release sockets, etc. */
	dispose?(): Promise<void>;
}

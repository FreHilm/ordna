import type { StoreContext } from "./store.js";
import type { Task } from "./schema.js";

/**
 * Event emitted by the backend's watcher.
 *
 * - `added`   : a new task appeared
 * - `changed` : an existing task's content changed
 * - `removed` : a task was deleted; carries `filePath` for file-mode
 *               (hybrid emits the same shape; namespace will gain an
 *               `id` variant once that backend lands in T-032)
 */
export type TaskEvent =
	| { type: "added"; task: Task }
	| { type: "changed"; task: Task }
	| { type: "removed"; filePath: string };

export type TaskEventListener = (event: TaskEvent) => void;

export interface WatchOptions {
	/**
	 * Reserved for future use. Today this is unused — the active
	 * backend controls its own watch behaviour.
	 */
	ignoreInitial?: boolean;
}

/**
 * Subscribe to task changes.
 *
 * Delegates to the active backend's `watch` method. The file backend
 * uses chokidar on `<tasksDir>`; future remote backends (hybrid uses
 * the same chokidar pattern; namespace polls `git for-each-ref`)
 * plug their own implementations behind the same listener contract.
 *
 * Returns an unsubscribe function. Call it on shutdown.
 */
export function watchTasks(
	ctx: StoreContext,
	listener: TaskEventListener,
	_options: WatchOptions = {},
): () => Promise<void> {
	return ctx.backend.watch(listener);
}

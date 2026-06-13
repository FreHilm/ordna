import type { StoreContext } from "./store.js";
import type { Task } from "./schema.js";

/**
 * Event emitted by the backend's watcher.
 *
 * - `added`    : a new task appeared
 * - `changed`  : an existing task's content changed
 * - `removed`  : a task was deleted; carries `filePath` for file/hybrid
 *                (and the synthetic `ref:<refname>` for namespace)
 * - `renamed`  : namespace auto-renumber resolved a push-collision by
 *                reallocating a fresh ID; carries both the old and new
 *                IDs so the UI can show "previously known as X" and
 *                clear any cached views keyed on `oldId`. Only the
 *                namespace backend emits this.
 */
export type TaskEvent =
	| { type: "added"; task: Task }
	| { type: "changed"; task: Task }
	| { type: "removed"; filePath: string }
	| { type: "renamed"; oldId: string; newId: string; task: Task };

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

// TaskEvent / TaskEventListener live in provider.ts as of T-020. Re-exported
// here so `import { TaskEvent } from ".../watcher.js"` callsites still work.
import type { TaskEvent, TaskEventListener } from "./provider.js";
import type { StoreContext } from "./store.js";

export type { TaskEvent, TaskEventListener };

export interface WatchOptions {
	/**
	 * Reserved for future use. Today this is unused — the active provider
	 * controls its own watch behavior.
	 */
	ignoreInitial?: boolean;
}

/**
 * Subscribe to task changes.
 *
 * As of T-021 the watch implementation lives inside the active provider.
 * `FileTaskProvider` runs a chokidar watcher on the tasks directory; remote
 * providers may use polling, webhooks, or GraphQL subscriptions.
 *
 * The returned function unsubscribes; call it on shutdown.
 */
export function watchTasks(
	ctx: StoreContext,
	listener: TaskEventListener,
	_options: WatchOptions = {},
): () => Promise<void> {
	return ctx.provider.watch(listener);
}

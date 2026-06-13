import type { OrdnaConfig } from "../config.js";
import type {
	Task,
	TaskCreateInput,
	TaskUpdateInput,
} from "../schema.js";
import type { TaskEventListener } from "../watcher.js";

/**
 * Reserved built-in status — accepted by `update` / `move` regardless
 * of whether it appears in `config.statuses`. Lives at the storage
 * layer (rather than `store.ts`) so backend implementations can
 * import it without a circular dependency on `store.ts`.
 */
export const ARCHIVED_STATUS = "archived";

/** True if `status` is in `config.statuses` or is the archived sentinel. */
export function isKnownStatus(config: OrdnaConfig, status: string): boolean {
	if (status === ARCHIVED_STATUS) return true;
	return config.statuses.includes(status);
}

/**
 * Storage-mode-specific options accepted by `list()`.
 *
 * Same shape as the public `ListTasksOptions` from `../store.ts`. Kept
 * separately so the backend interface is self-contained and doesn't
 * cross-import the store layer.
 */
export interface ListOptions {
	status?: string;
	assignee?: string;
	tag?: string;
}

/**
 * Internal seam between core's public API and the storage layer.
 *
 * **NOT EXPORTED from the package.** Lives under `storage/` and is
 * referenced only by `store.ts` and the backend implementations
 * themselves. Future modes (hybrid, namespace) are additional classes
 * in `storage/backends/` that implement this interface; there is no
 * plugin loader, no dynamic import, no `@frehilm/ordna-<name>`
 * resolution.
 *
 * Construction is cheap (no I/O). The first method call on a fresh
 * backend pays the I/O cost via the lazy `init()` pattern (see
 * `FileBackend.#ensureInit`).
 */
export interface Backend {
	readonly kind: "file" | "hybrid" | "namespace";

	/**
	 * Lazy setup. Not called by core; each backend method awaits its own
	 * internal `#ensureInit()` helper which calls `init()` once and
	 * caches the resolved promise. This is what keeps `createContext`
	 * synchronous.
	 */
	init(): Promise<void>;

	/**
	 * Clean up any resources the backend allocated (watcher handles,
	 * pending pushes, etc.). Long-lived hosts (`ordna web`, the TUI)
	 * call this on shutdown. One-shot CLI commands don't need to call
	 * it — the OS reclaims everything when the process exits.
	 */
	dispose(): Promise<void>;

	list(opts?: ListOptions): Promise<Task[]>;
	get(id: string): Promise<Task | null>;
	create(input: TaskCreateInput): Promise<Task>;
	update(id: string, patch: TaskUpdateInput): Promise<Task>;
	delete(id: string): Promise<void>;

	watch(listener: TaskEventListener): () => Promise<void>;

	/**
	 * File-mode-only operation in v1. Hybrid and namespace backends
	 * deliberately omit this — `commitTasks(ctx)` then throws a clear
	 * "this backend doesn't support commit" error.
	 */
	commit?(message?: string): Promise<void>;

	/**
	 * Pull remote updates into the backend's storage. Only namespace
	 * implements this in v1 — file mode has nothing to fetch, and
	 * hybrid's task content rides regular `git pull` on branches while
	 * its state ref auto-fetches on CAS conflict during writes. The
	 * presence of this method is the UI capability check (web shows
	 * the fetch button, TUI binds `r`) — consumers should detect via
	 * `typeof ctx.backend.fetch === "function"`.
	 *
	 * Returns the number of refs that changed (added / updated /
	 * removed by the fetch) and the wall-clock duration. Both surface
	 * in the UI as a "fetched N refs in Xms" toast.
	 */
	fetch?(): Promise<FetchResult>;
}

export interface FetchResult {
	refsUpdated: number;
	durationMs: number;
}

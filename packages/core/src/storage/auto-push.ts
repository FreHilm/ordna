const DEBOUNCE_MS = 50;

/**
 * Fire-and-forget push coalescer. Used by hybrid mode to keep its
 * state ref synced with `origin` without surprising the user with
 * synchronous network calls on every mutation.
 *
 * Semantics:
 * - `schedule()` is sync and never throws. Multiple rapid calls
 *   within ~50ms collapse into a single run of `push`.
 * - Runs happen in the background. Errors are logged to stderr; the
 *   user's command stays successful.
 * - `flush()` (called from `dispose()`) awaits any pending or
 *   in-flight run so the process can exit cleanly.
 *
 * The actual push strategy lives in the injected `push` callback
 * (hybrid passes `SyncRef.pushToOrigin`, which is lease-based and
 * merges on rejection); this class only owns debounce + lifecycle.
 */
export class PushQueue {
	#timer: ReturnType<typeof setTimeout> | null = null;
	#current: Promise<void> | null = null;
	#pending = false;

	constructor(
		private readonly push: () => Promise<void>,
		private readonly label = "ordna",
	) {}

	/**
	 * Mark "a push is wanted." Coalesces with any other calls in the
	 * next 50ms. Cheap and synchronous — safe to call from any
	 * mutation site.
	 */
	schedule(): void {
		if (this.#timer) clearTimeout(this.#timer);
		const t = setTimeout(() => {
			this.#timer = null;
			this.#trigger();
		}, DEBOUNCE_MS);
		// Don't keep the Node process alive just for the debounce timer —
		// the host (CLI command, web server) is what owns the lifetime.
		(t as unknown as { unref?: () => void }).unref?.();
		this.#timer = t;
	}

	/**
	 * Await any pending or in-flight push. Called from
	 * `HybridBackend.dispose()` so the last mutation's push completes
	 * before the process exits.
	 */
	async flush(): Promise<void> {
		// Fire any pending debounce timer immediately.
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = null;
			this.#trigger();
		}
		// Drain. Each iteration awaits the current push; once it
		// resolves, its `.finally` may have started another push if
		// something was queued during the run. Loop until quiet.
		while (this.#current) {
			await this.#current;
		}
	}

	#trigger(): void {
		if (this.#current) {
			// A push is mid-flight. Mark "do another after this one."
			// The current run's `.finally` picks up the flag.
			this.#pending = true;
			return;
		}
		this.#startPush();
	}

	#startPush(): void {
		this.#pending = false;
		this.#current = this.#runOnce().finally(() => {
			this.#current = null;
			if (this.#pending) this.#startPush();
		});
	}

	async #runOnce(): Promise<void> {
		try {
			await this.push();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[${this.label}] push failed: ${msg}`);
		}
	}
}

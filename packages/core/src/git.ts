import type { StoreContext } from "./store.js";

/**
 * Commit pending task changes.
 *
 * Delegates to the active backend's optional `commit()` method. The
 * built-in file backend implements it (stages the tasks directory and
 * runs `git commit`); future non-file backends (hybrid keeps it for
 * the file half; namespace deliberately omits it because tasks aren't
 * in the working tree) leave it undefined, in which case this throws
 * a clear error pointing the user at the right sync flow.
 */
export async function commitTasks(
	ctx: StoreContext,
	message?: string,
): Promise<void> {
	if (!ctx.backend.commit) {
		throw new Error(
			`Backend "${ctx.backend.kind}" does not support \`ordna commit\`. Use the backend's own sync flow instead.`,
		);
	}
	return ctx.backend.commit(message);
}

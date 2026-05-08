import type { StoreContext } from "./store.js";

/**
 * Commit pending task changes.
 *
 * Delegates to the active provider's optional `commit()` method. Today the
 * built-in `FileTaskProvider` implements it (stages the tasks directory and
 * runs `git commit`); remote providers (Jira / Linear) leave it undefined,
 * in which case this throws a clear error.
 */
export async function commitTasks(
	ctx: StoreContext,
	message?: string,
): Promise<void> {
	if (!ctx.provider.commit) {
		throw new Error(
			`Provider "${ctx.provider.kind}" does not support \`ordna commit\`. Use the remote tracker's own commit / sync flow instead.`,
		);
	}
	return ctx.provider.commit(message);
}

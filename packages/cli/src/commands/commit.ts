import { commitTasks } from "@frehilm/ordna-core";
import { ensureContextOrExit } from "../lib/ensure-context.js";
import { c } from "../colors.js";

export async function runCommit(message: string | undefined): Promise<void> {
	const ctx = await ensureContextOrExit();
	try {
		await commitTasks(ctx, message);
		console.log(c.green("Committed."));
	} catch (error) {
		console.error(c.red((error as Error).message));
		process.exitCode = 1;
	}
}

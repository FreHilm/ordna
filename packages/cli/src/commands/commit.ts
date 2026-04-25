import { commitTasks, createContext } from "@frehilm/ordna-core";
import { c } from "../colors.js";

export async function runCommit(message: string | undefined): Promise<void> {
	const ctx = createContext();
	try {
		await commitTasks(ctx, message);
		console.log(c.green("Committed."));
	} catch (error) {
		console.error(c.red((error as Error).message));
		process.exitCode = 1;
	}
}

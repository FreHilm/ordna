import { moveTask } from "@frehilm/ordna-core";
import { ensureContextOrExit } from "../lib/ensure-context.js";
import { c } from "../colors.js";
import { colorStatus } from "../format.js";

export async function runMove(id: string, status: string): Promise<void> {
	const ctx = await ensureContextOrExit();
	try {
		const task = await moveTask(id, status, ctx);
		console.log(`${c.bold(task.id)} → ${colorStatus(task.status)}`);
	} catch (error) {
		console.error(c.red((error as Error).message));
		process.exitCode = 1;
	}
}

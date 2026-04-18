import { createContext, moveTask } from "@ordna/core";
import { c } from "../colors.js";
import { colorStatus } from "../format.js";

export async function runMove(id: string, status: string): Promise<void> {
	const ctx = createContext();
	try {
		const task = await moveTask(id, status, ctx);
		console.log(`${c.bold(task.id)} → ${colorStatus(task.status)}`);
	} catch (error) {
		console.error(c.red((error as Error).message));
		process.exitCode = 1;
	}
}

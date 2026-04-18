import { createContext, updateTask } from "@ordna/core";
import { c } from "../colors.js";

export async function runAssign(id: string, assignee: string | undefined): Promise<void> {
	const ctx = createContext();
	const value = assignee && assignee.length > 0 ? assignee : null;
	try {
		const task = await updateTask(id, { assignee: value }, ctx);
		if (value === null) console.log(`${c.bold(task.id)} unassigned`);
		else console.log(`${c.bold(task.id)} → ${c.magenta(`@${value}`)}`);
	} catch (error) {
		console.error(c.red((error as Error).message));
		process.exitCode = 1;
	}
}

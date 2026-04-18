import { createContext, listTasks } from "@ordna/core";
import { c } from "../colors.js";
import { formatListRow, summarizeStatuses } from "../format.js";

export interface ListOptions {
	status?: string;
	assignee?: string;
	tag?: string;
}

export async function runList(options: ListOptions = {}): Promise<void> {
	const ctx = createContext();
	const tasks = await listTasks(ctx, options);
	if (tasks.length === 0) {
		console.log(c.dim("No tasks. Create one with `ordna create \"title\"`."));
		return;
	}
	for (const task of tasks) console.log(formatListRow(task));
	console.log("");
	console.log(summarizeStatuses(ctx.config, tasks));
}

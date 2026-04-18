import { createContext, createTask, type Priority } from "@ordna/core";
import { c } from "../colors.js";

export interface CreateOptions {
	assignee?: string;
	priority?: Priority;
	tags?: string[];
	dependsOn?: string[];
	status?: string;
}

export async function runCreate(title: string, options: CreateOptions = {}): Promise<void> {
	if (!title || title.trim().length === 0) {
		console.error(c.red("Title is required."));
		process.exitCode = 1;
		return;
	}
	const ctx = createContext();
	const task = await createTask(
		{
			title,
			assignee: options.assignee ?? null,
			priority: options.priority ?? null,
			tags: options.tags ?? [],
			depends_on: options.dependsOn ?? [],
			status: options.status,
		},
		ctx,
	);
	console.log(c.green(`Created ${c.bold(task.id)}: ${task.title}`));
	console.log(c.dim(`  ${task.filePath}`));
}

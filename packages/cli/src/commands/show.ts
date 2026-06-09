import { getTask } from "@frehilm/ordna-core";
import { ensureContextOrExit } from "../lib/ensure-context.js";
import { c } from "../colors.js";
import { formatTask } from "../format.js";

export async function runShow(id: string): Promise<void> {
	const task = await getTask(id, await ensureContextOrExit());
	if (!task) {
		console.error(c.red(`Task ${id} not found.`));
		process.exitCode = 1;
		return;
	}
	console.log(formatTask(task));
}

import type { OrdnaConfig, Task } from "@ordna/core";
import { c } from "./colors.js";

const STATUS_COLORS: Record<string, (t: string) => string> = {
	todo: c.gray,
	doing: c.yellow,
	done: c.green,
};

export function colorStatus(status: string): string {
	const fn = STATUS_COLORS[status] ?? c.cyan;
	return fn(status);
}

export function formatListRow(task: Task): string {
	const pieces = [
		c.bold(task.id.padEnd(8)),
		colorStatus(task.status.padEnd(8)),
		task.assignee ? c.magenta(`@${task.assignee}`.padEnd(14)) : " ".repeat(14),
		task.priority ? c.yellow(`!${task.priority}`.padEnd(8)) : " ".repeat(8),
		task.title,
	];
	return pieces.join(" ");
}

export function formatTask(task: Task): string {
	const lines: string[] = [];
	lines.push(`${c.bold(task.id)}  ${task.title}`);
	lines.push(
		[
			`  status: ${colorStatus(task.status)}`,
			`assignee: ${task.assignee ?? c.dim("—")}`,
			`priority: ${task.priority ?? c.dim("—")}`,
		].join("  "),
	);
	if (task.tags.length > 0) lines.push(`  tags: ${task.tags.map((t) => c.cyan(t)).join(", ")}`);
	if (task.depends_on.length > 0)
		lines.push(`  depends_on: ${task.depends_on.map((d) => c.blue(d)).join(", ")}`);
	lines.push(c.dim(`  created_at: ${task.created_at}   updated_at: ${task.updated_at}`));
	lines.push("");
	for (const section of task.sections) {
		if (section.heading === "") {
			lines.push(section.content);
			continue;
		}
		lines.push(c.bold(`## ${section.heading}`));
		if (section.content.length > 0) lines.push(section.content);
		lines.push("");
	}
	return lines.join("\n");
}

export function summarizeStatuses(config: OrdnaConfig, tasks: Task[]): string {
	const counts: Record<string, number> = {};
	for (const s of config.statuses) counts[s] = 0;
	for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
	return config.statuses.map((s) => `${colorStatus(s)}: ${counts[s] ?? 0}`).join("   ");
}

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { c } from "../colors.js";

const TEMPLATE = `# Ordna config — all keys optional.
tasksDir: tasks
schema: ordna
statuses: [todo, doing, done]
idPrefix: T
zeroPaddedIds: 3
webPort: 7420
`;

export function runInit(cwd: string = process.cwd()): void {
	const configDir = join(cwd, ".ordna");
	const configFile = join(configDir, "config.yaml");
	const tasksDir = join(cwd, "tasks");

	let created = 0;
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
		created++;
	}
	if (!existsSync(configFile)) {
		writeFileSync(configFile, TEMPLATE, "utf8");
		created++;
	}
	if (!existsSync(tasksDir)) {
		mkdirSync(tasksDir, { recursive: true });
		created++;
	}

	if (created === 0) {
		console.log(c.dim("Ordna already initialized in this repo."));
		return;
	}
	console.log(c.green("Initialized Ordna."));
	console.log(c.dim(`  ${configFile}`));
	console.log(c.dim(`  ${tasksDir}/`));
}

import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RepoFixture {
	cwd: string;
	tasksDir: string;
}

export function makeTempRepo(schema: "ordna" | "backlog" = "ordna"): RepoFixture {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-test-"));
	const configDir = join(cwd, ".ordna");
	mkdirSync(configDir, { recursive: true });
	const tasksDir = schema === "backlog" ? "backlog" : "tasks";
	writeFileSync(
		join(configDir, "config.yaml"),
		`tasksDir: ${tasksDir}\nschema: ${schema}\n`,
		"utf8",
	);
	const fullTasks = join(cwd, tasksDir);
	mkdirSync(fullTasks, { recursive: true });
	return { cwd, tasksDir: fullTasks };
}

export function writeTaskFile(filePath: string, content: string): void {
	writeFileSync(filePath, content, "utf8");
}

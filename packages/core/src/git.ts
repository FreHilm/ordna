import { spawn } from "node:child_process";
import type { StoreContext } from "./store.js";

function run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn("git", args, { cwd });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
		});
	});
}

export async function commitTasks(
	ctx: StoreContext,
	message = "chore(tasks): update",
): Promise<void> {
	await run(ctx.cwd, ["add", "--", ctx.config.tasksDir]);
	const status = await run(ctx.cwd, ["status", "--porcelain", "--", ctx.config.tasksDir]);
	if (status.stdout.trim().length === 0) {
		throw new Error("No task changes to commit.");
	}
	await run(ctx.cwd, ["commit", "-m", message, "--", ctx.config.tasksDir]);
}

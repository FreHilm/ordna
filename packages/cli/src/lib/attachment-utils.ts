import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { type Attachment, type StoreContext, type Task, readAttachment } from "@frehilm/ordna-core";

/** Human-readable byte size. */
export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Normalize a path typed into a prompt (or pasted by a terminal when a
 * file is dragged onto the window): strip surrounding quotes, unescape
 * `\ ` spaces, expand a leading `~`, and resolve against `cwd`.
 */
export function expandPath(input: string, cwd: string = process.cwd()): string {
	let p = input.trim();
	if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
		p = p.slice(1, -1);
	}
	p = p.replace(/\\ /g, " ");
	if (p === "~") p = homedir();
	else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
	return isAbsolute(p) ? p : resolve(cwd, p);
}

/**
 * Resolve an attachment to a path that an OS file handler can open.
 *
 * - file / hybrid: the working-tree file already on disk (`src` is a
 *   path relative to `tasksDir`).
 * - namespace (or any non-path `src`): extract the bytes to a temp file
 *   named after the attachment, since the blob has no working-tree home.
 */
export async function resolveOpenablePath(
	ctx: StoreContext,
	task: Task,
	att: Attachment,
): Promise<string> {
	if (!att.src.startsWith("git:")) {
		return join(ctx.tasksDir, att.src);
	}
	const { bytes } = await readAttachment(task.id, att.id, ctx);
	const dir = mkdtempSync(join(tmpdir(), `ordna-${task.id}-`));
	const out = join(dir, att.name);
	writeFileSync(out, bytes);
	return out;
}

/** Open a path with the platform's default handler. Best-effort, detached. */
export function openPath(path: string): void {
	const [cmd, args] =
		process.platform === "darwin"
			? ["open", [path]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", path]]
				: ["xdg-open", [path]];
	try {
		const child = spawn(cmd, args, { stdio: "ignore", detached: true });
		child.on("error", () => {
			// e.g. xdg-open missing — caller can't do much; swallow.
		});
		child.unref();
	} catch {
		// spawn threw synchronously (rare) — ignore.
	}
}

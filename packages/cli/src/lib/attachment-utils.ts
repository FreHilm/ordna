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
 * Extensions the in-TUI file viewer treats as text. Deliberately broad —
 * anything utf-8-ish renders fine in a terminal; truly binary formats
 * (png, zip, pdf) are excluded and get the image path or the
 * "open externally" fallback instead.
 */
const TEXT_EXTENSIONS = new Set([
	"md",
	"txt",
	"html",
	"htm",
	"xml",
	"json",
	"js",
	"jsx",
	"ts",
	"tsx",
	"css",
	"scss",
	"yaml",
	"yml",
	"csv",
	"toml",
	"ini",
	"conf",
	"env",
	"log",
	"sh",
	"zsh",
	"bash",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"c",
	"h",
	"cpp",
	"sql",
	"svg",
]);

/** True if the in-TUI viewer should render this attachment as text. */
export function isTextViewable(att: Attachment): boolean {
	if (att.type?.startsWith("text/")) return true;
	if (att.type === "application/json" || att.type === "image/svg+xml") return true;
	const dot = att.name.lastIndexOf(".");
	const ext = dot >= 0 ? att.name.slice(dot + 1).toLowerCase() : "";
	return TEXT_EXTENSIONS.has(ext);
}

/** True if the in-TUI viewer should render this attachment as an image. */
export function isImageViewable(att: Attachment): boolean {
	// svg is xml — terminal-image (jimp) can't rasterize it; view as text.
	return Boolean(att.type?.startsWith("image/")) && att.type !== "image/svg+xml";
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

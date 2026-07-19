import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OrdnaConfig } from "../config.js";
import type { Attachment } from "../schema.js";
import type { AttachmentInput, AttachmentStore } from "./backend.js";
import { listTaskBytes, writeTaskBytes } from "./file-io.js";
import { parseTask, serializeTask } from "./markdown.js";

/**
 * Directory under `tasksDir` where working-tree backends keep
 * attachment bytes. Relative paths stored in `Attachment.src` are
 * rooted here, e.g. `attachments/T-001/a1-chart.png`.
 */
export const ATTACHMENTS_DIRNAME = "attachments";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Best-effort MIME type from a filename extension. Returns null when
 * the extension is unknown — the record keeps `type: null` rather than
 * guessing `application/octet-stream`, so the UI can decide.
 */
export function inferMediaType(name: string): string | null {
	const dot = name.lastIndexOf(".");
	if (dot < 0) return null;
	const ext = name.slice(dot + 1).toLowerCase();
	return MEDIA_TYPES[ext] ?? null;
}

const MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	pdf: "application/pdf",
	txt: "text/plain",
	md: "text/markdown",
	csv: "text/csv",
	json: "application/json",
	zip: "application/zip",
	mp4: "video/mp4",
	mov: "video/quicktime",
};

/**
 * Strip directory separators and characters that are awkward on disk
 * or in git, collapsing them to `-`. Preserves a readable name and the
 * extension. Never returns empty (falls back to `file`).
 */
export function sanitizeFilename(name: string): string {
	const base = name.replace(/^.*[/\\]/, "");
	const cleaned = base
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[-.]+/, "")
		.replace(/-+/g, "-");
	return cleaned.length > 0 ? cleaned.slice(0, 80) : "file";
}

/**
 * Allocate the next attachment id (`a1`, `a2`, …) given the existing
 * records on a task. Gaps are not reused — we take `max + 1` so an id
 * is never silently recycled onto different bytes.
 */
export function nextAttachmentId(existing: Attachment[]): string {
	let max = 0;
	for (const att of existing) {
		const m = att.id.match(/^a(\d+)$/);
		if (m) {
			const n = Number.parseInt(m[1] as string, 10);
			if (n > max) max = n;
		}
	}
	return `a${max + 1}`;
}

/**
 * Remove a task's whole attachment directory. Called by the file and
 * hybrid backends' `delete()` so removing a task doesn't orphan its
 * attachment bytes on disk. Recursive + force: a task with no
 * attachments (no directory) is a silent no-op.
 */
export async function removeAttachmentsDir(tasksDir: string, taskId: string): Promise<void> {
	await rm(join(tasksDir, ATTACHMENTS_DIRNAME, taskId), {
		recursive: true,
		force: true,
	});
}

/** Build the `src` locator for a working-tree attachment (relative to `tasksDir`). */
export function attachmentSrc(taskId: string, attId: string, filename: string): string {
	return `${ATTACHMENTS_DIRNAME}/${taskId}/${attId}-${filename}`;
}

/** Build an `Attachment` record from input, allocating id and inferring type. */
export function buildAttachment(
	taskId: string,
	existing: Attachment[],
	input: AttachmentInput,
): Attachment {
	const id = nextAttachmentId(existing);
	const name = sanitizeFilename(input.name);
	return {
		id,
		name,
		type: input.type ?? inferMediaType(name),
		size: input.bytes.byteLength,
		added: today(),
		src: attachmentSrc(taskId, id, name),
	};
}

/**
 * Working-tree attachment store shared by the file and hybrid
 * backends. Bytes are written under `<tasksDir>/attachments/<taskId>/`
 * and committed to git like task files; the canonical metadata lives
 * in the task's frontmatter, which each method rewrites.
 *
 * The task file is located by scanning `tasksDir` (same posture as the
 * backends' `get`), so this store needs no reference to the backend
 * itself — keeping file and hybrid sharing one implementation.
 */
export class FileAttachmentStore implements AttachmentStore {
	constructor(
		private readonly tasksDir: string,
		private readonly config: OrdnaConfig,
	) {}

	async add(taskId: string, input: AttachmentInput): Promise<Attachment> {
		const { task } = await this.#findTask(taskId);
		const att = buildAttachment(taskId, task.attachments, input);

		const absPath = join(this.tasksDir, att.src);
		mkdirSync(dirname(absPath), { recursive: true });
		await writeFile(absPath, input.bytes);

		task.attachments = [...task.attachments, att];
		await this.#writeTask(task);
		return att;
	}

	async read(taskId: string, attId: string): Promise<{ meta: Attachment; bytes: Buffer }> {
		const { task } = await this.#findTask(taskId);
		const meta = task.attachments.find((a) => a.id === attId);
		if (!meta) {
			throw new Error(`Attachment ${attId} not found on ${taskId}.`);
		}
		const bytes = await readFile(join(this.tasksDir, meta.src));
		return { meta, bytes };
	}

	async remove(taskId: string, attId: string): Promise<void> {
		const { task } = await this.#findTask(taskId);
		const meta = task.attachments.find((a) => a.id === attId);
		if (!meta) {
			throw new Error(`Attachment ${attId} not found on ${taskId}.`);
		}
		// Best-effort byte removal — a missing file shouldn't block
		// dropping the registry entry (the file may already be gone).
		const absPath = join(this.tasksDir, meta.src);
		if (existsSync(absPath)) await unlink(absPath);

		task.attachments = task.attachments.filter((a) => a.id !== attId);
		await this.#writeTask(task);
	}

	async #findTask(taskId: string): Promise<{ task: ReturnType<typeof parseTask> }> {
		const entries = await listTaskBytes(this.tasksDir);
		for (const { filePath, raw } of entries) {
			try {
				const task = parseTask(raw, filePath);
				if (task.id === taskId) return { task };
			} catch {
				// skip malformed files, same as the backends' list()
			}
		}
		throw new Error(`Task ${taskId} not found.`);
	}

	async #writeTask(task: ReturnType<typeof parseTask>): Promise<void> {
		if (!task.filePath) {
			throw new Error(`Task ${task.id} has no filePath; cannot persist attachments.`);
		}
		const serialized = serializeTask(task, this.config.schema);
		await writeTaskBytes(task.filePath, serialized);
	}
}

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { addAttachment, canAttach, getTask, removeAttachment } from "@frehilm/ordna-core";
import { c } from "../colors.js";
import { expandPath, formatBytes } from "../lib/attachment-utils.js";
import { ensureContextOrExit } from "../lib/ensure-context.js";

export async function runAttach(id: string, filePath: string): Promise<void> {
	const ctx = await ensureContextOrExit();
	if (!canAttach(ctx)) {
		console.error(c.red(`storage: ${ctx.backend.kind} doesn't support attachments.`));
		process.exitCode = 1;
		return;
	}
	const abs = expandPath(filePath);
	let bytes: Buffer;
	try {
		bytes = await readFile(abs);
	} catch {
		console.error(c.red(`Cannot read file: ${abs}`));
		process.exitCode = 1;
		return;
	}
	try {
		const att = await addAttachment(id, { name: basename(abs), bytes }, ctx);
		console.log(
			`${c.green("Attached")} ${c.bold(att.name)} ${c.dim(`(${formatBytes(att.size)})`)} to ${c.bold(id)} as ${c.cyan(att.id)}`,
		);
	} catch (err) {
		console.error(c.red((err as Error).message));
		process.exitCode = 1;
	}
}

export async function runAttachments(id: string): Promise<void> {
	const ctx = await ensureContextOrExit();
	const task = await getTask(id, ctx);
	if (!task) {
		console.error(c.red(`Task ${id} not found.`));
		process.exitCode = 1;
		return;
	}
	if (task.attachments.length === 0) {
		console.log(c.dim(`${id} has no attachments.`));
		return;
	}
	for (const att of task.attachments) {
		console.log(
			`${c.cyan(att.id.padEnd(4))} ${c.bold(att.name)} ${c.dim(
				`· ${formatBytes(att.size)}${att.type ? ` · ${att.type}` : ""} · ${att.added}`,
			)}`,
		);
	}
}

export async function runDetach(id: string, attId: string): Promise<void> {
	const ctx = await ensureContextOrExit();
	if (!canAttach(ctx)) {
		console.error(c.red(`storage: ${ctx.backend.kind} doesn't support attachments.`));
		process.exitCode = 1;
		return;
	}
	try {
		await removeAttachment(id, attId, ctx);
		console.log(`${c.green("Removed")} ${c.cyan(attId)} from ${c.bold(id)}`);
	} catch (err) {
		console.error(c.red((err as Error).message));
		process.exitCode = 1;
	}
}

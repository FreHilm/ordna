import { basename } from "node:path";
import chokidar from "chokidar";
import type { StoreContext } from "./store.js";
import { parseTaskFile } from "./parser.js";
import type { Task } from "./schema.js";

export type TaskEvent =
	| { type: "added"; task: Task }
	| { type: "changed"; task: Task }
	| { type: "removed"; filePath: string };

export type TaskEventListener = (event: TaskEvent) => void;

export interface WatchOptions {
	ignoreInitial?: boolean;
}

export function watchTasks(
	ctx: StoreContext,
	listener: TaskEventListener,
	options: WatchOptions = {},
): () => Promise<void> {
	const watcher = chokidar.watch(ctx.tasksDir, {
		ignoreInitial: options.ignoreInitial ?? true,
		depth: 0,
		persistent: true,
	});

	const emitIfMarkdown = async (
		type: "added" | "changed",
		filePath: string,
	): Promise<void> => {
		if (!filePath.endsWith(".md")) return;
		try {
			const task = await parseTaskFile(filePath);
			listener({ type, task });
		} catch {
			// Ignore partial writes or malformed files.
		}
	};

	watcher.on("add", (path) => void emitIfMarkdown("added", path));
	watcher.on("change", (path) => void emitIfMarkdown("changed", path));
	watcher.on("unlink", (path) => {
		if (!path.endsWith(".md")) return;
		listener({ type: "removed", filePath: path });
	});

	return async () => {
		await watcher.close();
	};
}

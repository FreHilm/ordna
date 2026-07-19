import { spawn } from "node:child_process";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { OrdnaConfig } from "../../config.js";
import type { Task, TaskCreateInput, TaskUpdateInput } from "../../schema.js";
import type { TaskEventListener } from "../../watcher.js";
import { FileAttachmentStore, removeAttachmentsDir } from "../attachments.js";
import { type AttachmentStore, type Backend, type ListOptions, isKnownStatus } from "../backend.js";
import {
	deleteTaskFile,
	ensureTasksDir,
	filenameFor,
	listTaskBytes,
	nextIdFromScan,
	readTaskBytes,
	writeTaskBytes,
} from "../file-io.js";
import { defaultSectionsFor, parseTask, parseTaskFile, serializeTask } from "../markdown.js";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * File-system backend. Tasks are markdown files in `<cwd>/<tasksDir>`.
 * This is the default mode and the current behavior of `@frehilm/ordna-core`.
 *
 * Construction is cheap (no I/O). The first method call triggers
 * lazy `init()` via `#ensureInit()` so `createContext` stays
 * synchronous — important because the IDE that embeds core would
 * otherwise have to await context construction everywhere.
 */
export class FileBackend implements Backend {
	readonly kind = "file";
	readonly attachments: AttachmentStore;

	#initPromise: Promise<void> | null = null;
	readonly #activeWatchers = new Set<FSWatcher>();

	constructor(
		private readonly cwd: string,
		private readonly config: OrdnaConfig,
		private readonly tasksDir: string,
	) {
		this.attachments = new FileAttachmentStore(tasksDir, config);
	}

	async init(): Promise<void> {
		ensureTasksDir(this.tasksDir);
	}

	async #ensureInit(): Promise<void> {
		if (!this.#initPromise) this.#initPromise = this.init();
		return this.#initPromise;
	}

	async dispose(): Promise<void> {
		const closing: Promise<void>[] = [];
		for (const w of this.#activeWatchers) closing.push(w.close());
		this.#activeWatchers.clear();
		await Promise.all(closing);
	}

	async list(options: ListOptions = {}): Promise<Task[]> {
		await this.#ensureInit();
		const entries = await listTaskBytes(this.tasksDir);
		const tasks: Task[] = [];
		for (const { filePath, raw } of entries) {
			try {
				tasks.push(parseTask(raw, filePath));
			} catch {
				// Skip malformed tasks silently; surfaced via a dedicated validator later.
			}
		}

		let filtered = tasks;
		if (options.status) filtered = filtered.filter((t) => t.status === options.status);
		if (options.assignee) filtered = filtered.filter((t) => t.assignee === options.assignee);
		if (options.tag) {
			const tag = options.tag;
			filtered = filtered.filter((t) => t.tags.includes(tag));
		}

		filtered.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
		return filtered;
	}

	async get(id: string): Promise<Task | null> {
		const tasks = await this.list();
		return tasks.find((t) => t.id === id) ?? null;
	}

	async create(input: TaskCreateInput): Promise<Task> {
		await this.#ensureInit();

		const id = nextIdFromScan(this.config, this.tasksDir);
		const status = input.status ?? this.config.statuses[0];
		if (!status) throw new Error("Config has no statuses defined.");
		if (!isKnownStatus(this.config, status)) {
			throw new Error(`Status "${status}" is not in configured statuses.`);
		}

		const now = today();
		const task: Task = {
			id,
			title: input.title,
			status,
			assignee: input.assignee ?? null,
			priority: input.priority ?? null,
			tags: input.tags ?? [],
			depends_on: input.depends_on ?? [],
			created_at: now,
			updated_at: now,
			attachments: [],
			sections: defaultSectionsFor(this.config.schema),
			extra_frontmatter: {},
			filePath: "",
			rawContent: "",
		};

		const filename = filenameFor(id, task.title, this.config.schema, this.config);
		task.filePath = join(this.tasksDir, filename);
		const serialized = serializeTask(task, this.config.schema);
		task.rawContent = serialized;
		await writeTaskBytes(task.filePath, serialized);
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
		await this.#ensureInit();

		const existing = await this.get(id);
		if (!existing) throw new Error(`Task ${id} not found.`);

		const next: Task = {
			...existing,
			title: patch.title ?? existing.title,
			status: patch.status ?? existing.status,
			assignee: patch.assignee !== undefined ? patch.assignee : existing.assignee,
			priority: patch.priority !== undefined ? patch.priority : existing.priority,
			tags: patch.tags ?? existing.tags,
			depends_on: patch.depends_on ?? existing.depends_on,
			sections: patch.sections ?? existing.sections,
			updated_at: today(),
		};

		if (next.status !== existing.status && !isKnownStatus(this.config, next.status)) {
			throw new Error(`Status "${next.status}" is not in configured statuses.`);
		}

		const serialized = serializeTask(next, this.config.schema);
		next.rawContent = serialized;
		// File backend always writes filePath on create; this guard is
		// defensive against a misconfigured Task arriving from outside
		// the backend (e.g., a future migration script).
		if (!existing.filePath) {
			throw new Error(`Task ${id} has no filePath; cannot update in file mode.`);
		}
		await writeTaskBytes(existing.filePath, serialized);
		return next;
	}

	async delete(id: string): Promise<void> {
		await this.#ensureInit();
		const task = await this.get(id);
		if (!task) throw new Error(`Task ${id} not found.`);
		if (!task.filePath) {
			throw new Error(`Task ${id} has no filePath; cannot delete in file mode.`);
		}
		await deleteTaskFile(task.filePath);
		// Don't orphan the task's attachment bytes on disk.
		await removeAttachmentsDir(this.tasksDir, id);
	}

	watch(listener: TaskEventListener): () => Promise<void> {
		const watcher = chokidar.watch(this.tasksDir, {
			ignoreInitial: true,
			depth: 0,
			persistent: true,
		});
		this.#activeWatchers.add(watcher);

		const emitIfMarkdown = async (type: "added" | "changed", filePath: string): Promise<void> => {
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
			this.#activeWatchers.delete(watcher);
			await watcher.close();
		};
	}

	async commit(message = "chore(tasks): update"): Promise<void> {
		await this.#ensureInit();
		const tasksDirArg = this.config.tasksDir;
		await runGit(this.cwd, ["add", "--", tasksDirArg]);
		const status = await runGit(this.cwd, ["status", "--porcelain", "--", tasksDirArg]);
		if (status.stdout.trim().length === 0) {
			throw new Error("No task changes to commit.");
		}
		await runGit(this.cwd, ["commit", "-m", message, "--", tasksDirArg]);
	}
}

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
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

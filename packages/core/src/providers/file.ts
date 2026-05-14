import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { OrdnaConfig } from "../config.js";
import { formatId, nextId, parseId } from "../ids.js";
import { parseTask, parseTaskFile } from "../parser.js";
import type {
	ListOptions,
	TaskEvent,
	TaskEventListener,
	TaskProvider,
} from "../provider.js";
import type {
	SchemaMode,
	Task,
	TaskCreateInput,
	TaskUpdateInput,
} from "../schema.js";
import { defaultSectionsFor, serializeTask } from "../writer.js";

const ARCHIVED_STATUS = "archived";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function slugifyTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

function filenameFor(
	id: string,
	title: string,
	mode: SchemaMode,
	config: OrdnaConfig,
): string {
	if (mode === "backlog") {
		const numeric = parseId(config, id);
		const numericPart = numeric ?? id;
		const slug = slugifyTitle(title) || "task";
		return `task-${numericPart} - ${slug}.md`;
	}
	return `${id}.md`;
}

function isKnownStatus(config: OrdnaConfig, status: string): boolean {
	if (status === ARCHIVED_STATUS) return true;
	return config.statuses.includes(status);
}

function runGit(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
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
			else
				reject(
					new Error(
						`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`,
					),
				);
		});
	});
}

/**
 * Built-in file-system backend for Ordna.
 *
 * Reads / writes one markdown file per task in `<cwd>/<config.tasksDir>`.
 * Watches the directory with chokidar. Implements `commit` via the local
 * `git` binary.
 *
 * Constructed by `loadProvider` (providers/load.ts) when
 * `config.provider === "file"`. External providers (`@frehilm/ordna-jira`,
 * `@frehilm/ordna-linear`, etc.) are dynamically imported by the same
 * loader.
 */
export class FileTaskProvider implements TaskProvider {
	readonly kind = "file";

	private readonly activeWatchers = new Set<FSWatcher>();

	constructor(
		private readonly cwd: string,
		private readonly config: OrdnaConfig,
	) {}

	private get tasksDir(): string {
		return join(this.cwd, this.config.tasksDir);
	}

	/**
	 * Ensure the tasks directory exists. Safe to call multiple times.
	 * Not invoked automatically by `createContext` today — `create()` lazily
	 * mkdir's the directory on first write. T-023 may wire `init()` into the
	 * createContext path once we have a clear signal that providers need
	 * eager initialization (Jira / Linear may want to validate auth here).
	 */
	async init(): Promise<void> {
		const dir = this.tasksDir;
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}

	/**
	 * Close any active chokidar watchers held by this provider. Not yet
	 * invoked by core (deferred to T-023). Watchers also have their own
	 * unsubscribe returned from `watch()`; this is a sweep for the long-lived
	 * provider lifecycle.
	 */
	async dispose(): Promise<void> {
		const closing: Promise<void>[] = [];
		for (const w of this.activeWatchers) closing.push(w.close());
		this.activeWatchers.clear();
		await Promise.all(closing);
	}

	async list(options: ListOptions = {}): Promise<Task[]> {
		const dir = this.tasksDir;
		if (!existsSync(dir)) return [];

		const entries = readdirSync(dir, { withFileTypes: true });
		const tasks: Task[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const filePath = join(dir, entry.name);
			const raw = await readFile(filePath, "utf8");
			try {
				tasks.push(parseTask(raw, filePath));
			} catch {
				// Skip malformed tasks silently; surfaced via dedicated validator later.
			}
		}

		let filtered = tasks;
		if (options.status)
			filtered = filtered.filter((t) => t.status === options.status);
		if (options.assignee)
			filtered = filtered.filter((t) => t.assignee === options.assignee);
		if (options.tag)
			filtered = filtered.filter((t) =>
				t.tags.includes(options.tag as string),
			);

		filtered.sort((a, b) =>
			a.id.localeCompare(b.id, undefined, { numeric: true }),
		);
		return filtered;
	}

	async get(id: string): Promise<Task | null> {
		const tasks = await this.list();
		return tasks.find((t) => t.id === id) ?? null;
	}

	async create(input: TaskCreateInput): Promise<Task> {
		const dir = this.tasksDir;
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const id = nextId(this.config, dir);
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
			sections: defaultSectionsFor(this.config.schema),
			extra_frontmatter: {},
			filePath: "",
			rawContent: "",
		};

		const filename = filenameFor(id, task.title, this.config.schema, this.config);
		task.filePath = join(dir, filename);
		const serialized = serializeTask(task, this.config.schema);
		task.rawContent = serialized;
		await writeFile(task.filePath, serialized, "utf8");
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
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
		// Invariant: file-backed tasks always carry filePath. The narrowing here
		// is for TS; at runtime this can't happen through the FileTaskProvider.
		if (!existing.filePath) {
			throw new Error(
				`Task ${id} has no filePath; FileTaskProvider invariant violated.`,
			);
		}
		await writeFile(existing.filePath, serialized, "utf8");
		return next;
	}

	async move(id: string, status: string): Promise<Task> {
		// The depends_on gate lives in core's `moveTask` wrapper; by the time
		// we reach here the gate has already accepted the transition.
		return this.update(id, { status });
	}

	async delete(id: string): Promise<void> {
		const task = await this.get(id);
		if (!task) throw new Error(`Task ${id} not found.`);
		if (!task.filePath) {
			throw new Error(
				`Task ${id} has no filePath; FileTaskProvider invariant violated.`,
			);
		}
		await unlink(task.filePath);
	}

	watch(listener: TaskEventListener): () => Promise<void> {
		const watcher = chokidar.watch(this.tasksDir, {
			ignoreInitial: true,
			depth: 0,
			persistent: true,
		});
		this.activeWatchers.add(watcher);

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
			listener({
				type: "removed",
				id: basename(path, ".md"),
				filePath: path,
			} satisfies TaskEvent);
		});

		return async () => {
			this.activeWatchers.delete(watcher);
			await watcher.close();
		};
	}

	async commit(message = "chore(tasks): update"): Promise<void> {
		const dir = this.config.tasksDir;
		await runGit(this.cwd, ["add", "--", dir]);
		const status = await runGit(this.cwd, [
			"status",
			"--porcelain",
			"--",
			dir,
		]);
		if (status.stdout.trim().length === 0) {
			throw new Error("No task changes to commit.");
		}
		await runGit(this.cwd, ["commit", "-m", message, "--", dir]);
	}
}

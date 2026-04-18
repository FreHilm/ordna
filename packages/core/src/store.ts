import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type OrdnaConfig, loadConfig, resolveTasksDir } from "./config.js";
import { formatId, nextId, parseId } from "./ids.js";
import { parseTask } from "./parser.js";
import type { SchemaMode, Section, Task, TaskCreateInput, TaskUpdateInput } from "./schema.js";
import { defaultSectionsFor, serializeTask } from "./writer.js";

export interface StoreContext {
	cwd: string;
	config: OrdnaConfig;
	tasksDir: string;
}

export interface ListTasksOptions {
	status?: string;
	assignee?: string;
	tag?: string;
}

export function createContext(cwd = process.cwd()): StoreContext {
	const config = loadConfig({ cwd });
	const tasksDir = resolveTasksDir(config, cwd);
	return { cwd, config, tasksDir };
}

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

function filenameFor(id: string, title: string, mode: SchemaMode, config: OrdnaConfig): string {
	if (mode === "backlog") {
		const numeric = parseId(config, id);
		const numericPart = numeric ?? id;
		const slug = slugifyTitle(title) || "task";
		return `task-${numericPart} - ${slug}.md`;
	}
	return `${id}.md`;
}

export async function listTasks(
	ctx: StoreContext = createContext(),
	options: ListTasksOptions = {},
): Promise<Task[]> {
	if (!existsSync(ctx.tasksDir)) return [];

	const entries = readdirSync(ctx.tasksDir, { withFileTypes: true });
	const tasks: Task[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const filePath = join(ctx.tasksDir, entry.name);
		const raw = await readFile(filePath, "utf8");
		try {
			tasks.push(parseTask(raw, filePath));
		} catch {
			// Skip malformed tasks silently; surfaced via dedicated validator later.
		}
	}

	let filtered = tasks;
	if (options.status) filtered = filtered.filter((t) => t.status === options.status);
	if (options.assignee) filtered = filtered.filter((t) => t.assignee === options.assignee);
	if (options.tag) filtered = filtered.filter((t) => t.tags.includes(options.tag as string));

	filtered.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
	return filtered;
}

export async function getTask(id: string, ctx: StoreContext = createContext()): Promise<Task | null> {
	const tasks = await listTasks(ctx);
	return tasks.find((t) => t.id === id) ?? null;
}

export async function createTask(
	input: TaskCreateInput,
	ctx: StoreContext = createContext(),
): Promise<Task> {
	if (!existsSync(ctx.tasksDir)) mkdirSync(ctx.tasksDir, { recursive: true });

	const id = nextId(ctx.config, ctx.tasksDir);
	const status = input.status ?? ctx.config.statuses[0];
	if (!status) throw new Error("Config has no statuses defined.");
	if (!ctx.config.statuses.includes(status)) {
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
		sections: defaultSectionsFor(ctx.config.schema),
		extra_frontmatter: {},
		filePath: "",
		rawContent: "",
	};

	const filename = filenameFor(id, task.title, ctx.config.schema, ctx.config);
	task.filePath = join(ctx.tasksDir, filename);
	const serialized = serializeTask(task, ctx.config.schema);
	task.rawContent = serialized;
	await writeFile(task.filePath, serialized, "utf8");
	return task;
}

export async function updateTask(
	id: string,
	patch: TaskUpdateInput,
	ctx: StoreContext = createContext(),
): Promise<Task> {
	const existing = await getTask(id, ctx);
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

	if (next.status !== existing.status && !ctx.config.statuses.includes(next.status)) {
		throw new Error(`Status "${next.status}" is not in configured statuses.`);
	}

	const serialized = serializeTask(next, ctx.config.schema);
	next.rawContent = serialized;
	await writeFile(existing.filePath, serialized, "utf8");
	return next;
}

export async function moveTask(
	id: string,
	status: string,
	ctx: StoreContext = createContext(),
): Promise<Task> {
	const terminal = ctx.config.statuses[ctx.config.statuses.length - 1];
	if (status === terminal) {
		const task = await getTask(id, ctx);
		if (!task) throw new Error(`Task ${id} not found.`);
		if (task.depends_on.length > 0) {
			const all = await listTasks(ctx);
			const byId = new Map(all.map((t) => [t.id, t]));
			const unfinished = task.depends_on.filter((dep) => {
				const d = byId.get(dep);
				return !d || d.status !== terminal;
			});
			if (unfinished.length > 0) {
				throw new Error(
					`Cannot move ${id} to ${status}: dependencies not ${terminal}: ${unfinished.join(", ")}`,
				);
			}
		}
	}
	return updateTask(id, { status }, ctx);
}

export async function deleteTask(id: string, ctx: StoreContext = createContext()): Promise<void> {
	const task = await getTask(id, ctx);
	if (!task) throw new Error(`Task ${id} not found.`);
	await unlink(task.filePath);
}

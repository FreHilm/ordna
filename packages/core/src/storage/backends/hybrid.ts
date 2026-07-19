import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { OrdnaConfig } from "../../config.js";
import type { Task, TaskCreateInput, TaskUpdateInput } from "../../schema.js";
import type { TaskEventListener } from "../../watcher.js";
import { FileAttachmentStore, removeAttachmentsDir } from "../attachments.js";
import { PushQueue } from "../auto-push.js";
import {
	ARCHIVED_STATUS,
	type AttachmentStore,
	type Backend,
	type ListOptions,
	isKnownStatus,
} from "../backend.js";
import {
	deleteTaskFile,
	ensureTasksDir,
	filenameFor,
	listTaskBytes,
	writeTaskBytes,
} from "../file-io.js";
import { GitRunner } from "../git-ref.js";
import { defaultSectionsFor, parseTask, parseTaskFile, serializeTask } from "../markdown.js";
import { type Op, SyncRef } from "../sync-ref.js";

const SYNC_REF_NAME = "refs/ordna/state";
const SYNC_PUSH_REFSPEC = `+${SYNC_REF_NAME}:${SYNC_REF_NAME}`;

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
	return new Date().toISOString();
}

/**
 * Hybrid storage backend.
 *
 * Tasks stay as markdown files in `tasks/*.md` — same on-disk layout
 * as `FileBackend`, so existing tooling that reads task files Just
 * Works. The difference: shared metadata moves into a single git ref
 * at `refs/ordna/state`. The blob there holds:
 *
 *  - `next_id`: a CAS-bumped allocator that prevents two offline
 *    collaborators from both picking the same task number
 *  - `ops`: an append-only audit log of every create / update /
 *    archive / delete
 *
 * Every mutation does two atomic writes (one to disk, one to the
 * ref) and fires a best-effort coalesced push to keep `origin` in
 * sync. Reads stay file-system-only (no ref involvement in v1).
 */
export class HybridBackend implements Backend {
	readonly kind = "hybrid";
	readonly attachments: AttachmentStore;

	#initPromise: Promise<void> | null = null;
	readonly #activeWatchers = new Set<FSWatcher>();
	readonly #git: GitRunner;
	#sync: SyncRef | null = null;
	#pushQueue: PushQueue | null = null;
	#cachedActor: string | null = null;

	constructor(
		private readonly cwd: string,
		private readonly config: OrdnaConfig,
		private readonly tasksDir: string,
	) {
		this.#git = new GitRunner(cwd);
		this.attachments = new FileAttachmentStore(tasksDir, config);
	}

	async init(): Promise<void> {
		await this.#git.ensureRepository();
		ensureTasksDir(this.tasksDir);
		this.#sync = new SyncRef(this.#git, SYNC_REF_NAME);
		this.#pushQueue = new PushQueue(this.#git, SYNC_PUSH_REFSPEC, "ordna-hybrid");
	}

	async #ensureInit(): Promise<void> {
		if (!this.#initPromise) this.#initPromise = this.init();
		return this.#initPromise;
	}

	async dispose(): Promise<void> {
		// Close all watchers first so a watcher event doesn't fire
		// another mutation while we're flushing.
		const closing: Promise<void>[] = [];
		for (const w of this.#activeWatchers) closing.push(w.close());
		this.#activeWatchers.clear();
		await Promise.all(closing);
		if (this.#pushQueue) {
			await this.#pushQueue.flush();
		}
	}

	// ---------------- reads ----------------

	async list(options: ListOptions = {}): Promise<Task[]> {
		await this.#ensureInit();
		const entries = await listTaskBytes(this.tasksDir);
		const tasks: Task[] = [];
		for (const { filePath, raw } of entries) {
			try {
				tasks.push(parseTask(raw, filePath));
			} catch {
				// Skip malformed tasks silently (same posture as file mode).
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

	// ---------------- writes ----------------

	async create(input: TaskCreateInput): Promise<Task> {
		await this.#ensureInit();
		const sync = this.#sync as SyncRef;
		const pushQueue = this.#pushQueue as PushQueue;

		const status = input.status ?? this.config.statuses[0];
		if (!status) throw new Error("Config has no statuses defined.");
		if (!isKnownStatus(this.config, status)) {
			throw new Error(`Status "${status}" is not in configured statuses.`);
		}

		// CAS-allocate the next id from the sync ref. This is what
		// makes hybrid mode safe across offline collaborators.
		const id = await sync.allocateNextId(this.config);

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

		await sync.appendOp(await this.#buildOp("create", id));
		pushQueue.schedule();
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
		await this.#ensureInit();
		const sync = this.#sync as SyncRef;
		const pushQueue = this.#pushQueue as PushQueue;

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
		if (!existing.filePath) {
			throw new Error(`Task ${id} has no filePath; cannot update in hybrid mode.`);
		}
		await writeTaskBytes(existing.filePath, serialized);

		// Light op classification: a status-change to "archived" gets
		// its own op kind; everything else is a generic update. Richer
		// classification (move via status, changed-field lists) is
		// deferred to the follow-up that adds op-specific fields.
		const opKind: Op["op"] = patch.status === ARCHIVED_STATUS ? "archive" : "update";
		await sync.appendOp(await this.#buildOp(opKind, id));
		pushQueue.schedule();
		return next;
	}

	async delete(id: string): Promise<void> {
		await this.#ensureInit();
		const sync = this.#sync as SyncRef;
		const pushQueue = this.#pushQueue as PushQueue;

		const task = await this.get(id);
		if (!task) throw new Error(`Task ${id} not found.`);
		if (!task.filePath) {
			throw new Error(`Task ${id} has no filePath; cannot delete in hybrid mode.`);
		}
		await deleteTaskFile(task.filePath);
		// Don't orphan the task's attachment bytes on disk.
		await removeAttachmentsDir(this.tasksDir, id);

		await sync.appendOp(await this.#buildOp("delete", id));
		pushQueue.schedule();
	}

	// ---------------- watch ----------------

	watch(listener: TaskEventListener): () => Promise<void> {
		// Same chokidar setup as FileBackend. Sync ref doesn't drive
		// watcher events in v1 — the file watcher is fast and reliable
		// for the task-content changes that the TUI / web care about.
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

	// ---------------- commit (file-mode parity) ----------------

	async commit(message = "chore(tasks): update"): Promise<void> {
		await this.#ensureInit();
		const tasksDirArg = this.config.tasksDir;
		await this.#git.run(["add", "--", tasksDirArg]);
		const status = await this.#git.run(["status", "--porcelain", "--", tasksDirArg]);
		if (status.trim().length === 0) {
			throw new Error("No task changes to commit.");
		}
		await this.#git.run(["commit", "-m", message, "--", tasksDirArg]);
	}

	// ---------------- internals ----------------

	async #buildOp(op: Op["op"], id: string): Promise<Op> {
		return {
			ts: nowIso(),
			actor: await this.#resolveActor(),
			op,
			id,
		};
	}

	async #resolveActor(): Promise<string> {
		if (this.#cachedActor !== null) return this.#cachedActor;
		// Order: git config user.email → ORDNA_ACTOR env → "unknown".
		const fromGit = await this.#git.userEmail();
		if (fromGit) {
			this.#cachedActor = fromGit;
			return fromGit;
		}
		const fromEnv = process.env.ORDNA_ACTOR;
		if (fromEnv && fromEnv.trim().length > 0) {
			this.#cachedActor = fromEnv.trim();
			return this.#cachedActor;
		}
		this.#cachedActor = "unknown";
		return this.#cachedActor;
	}
}

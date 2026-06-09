import type { OrdnaConfig } from "../../config.js";
import { formatId, parseId } from "../../ids.js";
import type {
	Task,
	TaskCreateInput,
	TaskUpdateInput,
} from "../../schema.js";
import type { TaskEvent, TaskEventListener } from "../../watcher.js";
import {
	ARCHIVED_STATUS,
	type Backend,
	type ListOptions,
	isKnownStatus,
} from "../backend.js";
import { GitRunner } from "../git-ref.js";
import { PushQueue } from "../auto-push.js";
import {
	defaultSectionsFor,
	parseTaskBytes,
	serializeTask,
} from "../markdown.js";

const REF_PREFIX = "refs/ordna/tasks/";
const TASK_REF_PATTERN = `${REF_PREFIX}*`;
const NAMESPACE_PUSH_REFSPEC = `+${REF_PREFIX}*:${REF_PREFIX}*`;

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function refnameFor(id: string): string {
	return `${REF_PREFIX}${id}`;
}

function idFromRefname(refname: string): string | null {
	if (!refname.startsWith(REF_PREFIX)) return null;
	const id = refname.slice(REF_PREFIX.length);
	return id.length > 0 ? id : null;
}

/**
 * Heuristic: detect git CAS conflicts from `update-ref` failures so we
 * can wrap them in a clearer "ref moved underneath" message. Same
 * pattern as SyncRef but standalone — namespace doesn't auto-retry.
 */
function isCASConflict(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return (
		msg.includes("update-ref") &&
		(msg.includes("cannot lock ref") ||
			msg.includes("is at") ||
			msg.includes("expected") ||
			msg.includes("missing"))
	);
}

/**
 * Namespace storage backend.
 *
 * Tasks live as git blobs under `refs/ordna/tasks/<id>` — one ref per
 * task, no working-tree files. `git status` stays clean. `git log` on
 * branches doesn't see task mutations. Sync via `git push` /
 * `git fetch` on the ref namespace.
 *
 * Differences from hybrid mode:
 * - Tasks are git blobs, not files. `tasks/` is never created.
 * - Allocator scans existing task refs (no SyncRef — audit log is
 *   deferred; can be added later by reusing T-031's SyncRef with only
 *   the `ops` field populated).
 * - Watcher polls `git for-each-ref` (refs have no kernel-level
 *   change-notification path).
 * - `commit()` is a deliberate no-op — auto-push handles sync; there
 *   are no working-tree changes to stage.
 * - CAS update-conflicts are surfaced to the user (no fetch-and-retry
 *   like SyncRef does). Two writers racing on the same task ref is
 *   meaningful — auto-retry would mask intentional concurrent edits.
 */
export class NamespaceBackend implements Backend {
	readonly kind = "namespace";

	#initPromise: Promise<void> | null = null;
	readonly #git: GitRunner;
	#pushQueue: PushQueue | null = null;
	#pollTimer: ReturnType<typeof setTimeout> | null = null;
	#listeners = new Set<TaskEventListener>();
	#lastSnapshot = new Map<string, string>(); // refname → oid
	#pollIntervalMs: number;
	#disposed = false;

	constructor(
		private readonly cwd: string,
		private readonly config: OrdnaConfig,
	) {
		this.#git = new GitRunner(cwd);
		this.#pollIntervalMs = config.namespace?.pollIntervalMs ?? 1000;
	}

	async init(): Promise<void> {
		await this.#git.ensureRepository();
		this.#pushQueue = new PushQueue(
			this.#git,
			NAMESPACE_PUSH_REFSPEC,
			"ordna-namespace",
		);
	}

	async #ensureInit(): Promise<void> {
		if (!this.#initPromise) this.#initPromise = this.init();
		return this.#initPromise;
	}

	async dispose(): Promise<void> {
		this.#disposed = true;
		if (this.#pollTimer) {
			clearTimeout(this.#pollTimer);
			this.#pollTimer = null;
		}
		this.#listeners.clear();
		this.#lastSnapshot.clear();
		if (this.#pushQueue) {
			await this.#pushQueue.flush();
		}
	}

	// ---------------- reads ----------------

	async list(options: ListOptions = {}): Promise<Task[]> {
		await this.#ensureInit();
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		const tasks: Task[] = [];
		for (const { refname, oid } of refs) {
			const id = idFromRefname(refname);
			if (!id) continue;
			try {
				const raw = await this.#git.catBlob(oid);
				const task = parseTaskBytes(raw, `ref:${refname}`);
				// filePath is set by parseTaskBytes to the synthetic
				// `ref:` value — strip so consumers see undefined and
				// take the "no on-disk file" branch.
				delete task.filePath;
				tasks.push(task);
			} catch {
				// Skip unreadable / malformed blobs silently (same posture as file mode).
			}
		}

		let filtered = tasks;
		if (options.status)
			filtered = filtered.filter((t) => t.status === options.status);
		if (options.assignee)
			filtered = filtered.filter((t) => t.assignee === options.assignee);
		if (options.tag) {
			const tag = options.tag;
			filtered = filtered.filter((t) => t.tags.includes(tag));
		}
		filtered.sort((a, b) =>
			a.id.localeCompare(b.id, undefined, { numeric: true }),
		);
		return filtered;
	}

	async get(id: string): Promise<Task | null> {
		await this.#ensureInit();
		const refname = refnameFor(id);
		const refs = await this.#git.forEachRef(refname);
		const entry = refs.find((r) => r.refname === refname);
		if (!entry) return null;
		try {
			const raw = await this.#git.catBlob(entry.oid);
			const task = parseTaskBytes(raw, `ref:${refname}`);
			delete task.filePath;
			return task;
		} catch {
			return null;
		}
	}

	// ---------------- writes ----------------

	async create(input: TaskCreateInput): Promise<Task> {
		await this.#ensureInit();
		const pushQueue = this.#pushQueue as PushQueue;

		const status = input.status ?? this.config.statuses[0];
		if (!status) throw new Error("Config has no statuses defined.");
		if (!isKnownStatus(this.config, status)) {
			throw new Error(`Status "${status}" is not in configured statuses.`);
		}

		const id = await this.#allocateNextId();
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
			rawContent: "",
		};
		const serialized = serializeTask(task, this.config.schema);
		task.rawContent = serialized;

		const newOid = await this.#git.hashObject(serialized);
		// CAS: empty-string expected-old means "must not exist." Defends
		// against two offline machines both writing T-001.
		try {
			await this.#git.updateRef(refnameFor(id), newOid, "");
		} catch (err) {
			if (isCASConflict(err)) {
				throw new Error(
					`ordna: ${id} already exists at ${refnameFor(id)}. Another writer landed this ID first; pull and retry.`,
				);
			}
			throw err;
		}
		pushQueue.schedule();
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
		await this.#ensureInit();
		const pushQueue = this.#pushQueue as PushQueue;

		const refname = refnameFor(id);
		const refs = await this.#git.forEachRef(refname);
		const entry = refs.find((r) => r.refname === refname);
		if (!entry) throw new Error(`Task ${id} not found.`);
		const currentOid = entry.oid;

		const raw = await this.#git.catBlob(currentOid);
		const existing = parseTaskBytes(raw, `ref:${refname}`);
		delete existing.filePath;

		const next: Task = {
			...existing,
			title: patch.title ?? existing.title,
			status: patch.status ?? existing.status,
			assignee:
				patch.assignee !== undefined ? patch.assignee : existing.assignee,
			priority:
				patch.priority !== undefined ? patch.priority : existing.priority,
			tags: patch.tags ?? existing.tags,
			depends_on: patch.depends_on ?? existing.depends_on,
			sections: patch.sections ?? existing.sections,
			updated_at: today(),
		};
		if (
			next.status !== existing.status &&
			!isKnownStatus(this.config, next.status)
		) {
			throw new Error(`Status "${next.status}" is not in configured statuses.`);
		}

		const serialized = serializeTask(next, this.config.schema);
		next.rawContent = serialized;
		const newOid = await this.#git.hashObject(serialized);
		try {
			await this.#git.updateRef(refname, newOid, currentOid);
		} catch (err) {
			if (isCASConflict(err)) {
				throw new Error(
					`ordna: ${id} moved underneath us. Another writer updated this task between our read and write; pull (\`git fetch origin '+${refname}:${refname}'\`) and retry.`,
				);
			}
			throw err;
		}
		pushQueue.schedule();
		return next;
	}

	async delete(id: string): Promise<void> {
		await this.#ensureInit();
		const pushQueue = this.#pushQueue as PushQueue;

		const refname = refnameFor(id);
		const refs = await this.#git.forEachRef(refname);
		const entry = refs.find((r) => r.refname === refname);
		if (!entry) throw new Error(`Task ${id} not found.`);
		try {
			await this.#git.deleteRef(refname, entry.oid);
		} catch (err) {
			if (isCASConflict(err)) {
				throw new Error(
					`ordna: ${id} moved underneath us before delete. Another writer changed this task; pull and retry.`,
				);
			}
			throw err;
		}
		pushQueue.schedule();
	}

	// ---------------- watch ----------------

	watch(listener: TaskEventListener): () => Promise<void> {
		this.#listeners.add(listener);
		// Seed the snapshot once and start polling on the first
		// subscription so the initial poll doesn't classify existing
		// refs as `added`.
		if (this.#listeners.size === 1 && this.#pollTimer === null) {
			void this.#seedSnapshot().then(() => {
				if (!this.#disposed && this.#listeners.size > 0) {
					this.#schedulePoll();
				}
			});
		}
		return async () => {
			this.#listeners.delete(listener);
			if (this.#listeners.size === 0 && this.#pollTimer !== null) {
				clearTimeout(this.#pollTimer);
				this.#pollTimer = null;
			}
		};
	}

	// ---------------- commit (deliberate no-op) ----------------

	async commit(_message?: string): Promise<void> {
		// Tasks live outside the working tree; there's nothing to stage
		// or commit. Auto-push handles sync silently. We could throw
		// "namespace doesn't support commit," but `ordna commit` is
		// muscle memory — making it a silent success matches the
		// "working tree stays clean" model better.
	}

	// ---------------- internals ----------------

	async #allocateNextId(): Promise<string> {
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		let max = 0;
		for (const { refname } of refs) {
			const id = idFromRefname(refname);
			if (!id) continue;
			const n = parseId(this.config, id);
			if (n !== null && n > max) max = n;
		}
		return formatId(this.config, max + 1);
	}

	async #seedSnapshot(): Promise<void> {
		await this.#ensureInit();
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		this.#lastSnapshot.clear();
		for (const { refname, oid } of refs) {
			this.#lastSnapshot.set(refname, oid);
		}
	}

	#schedulePoll(): void {
		if (this.#disposed) return;
		const t = setTimeout(() => {
			this.#pollTimer = null;
			void this.#poll();
		}, this.#pollIntervalMs);
		// Don't keep the Node process alive on the poll timer alone —
		// the host (TUI / web) owns the lifetime.
		(t as unknown as { unref?: () => void }).unref?.();
		this.#pollTimer = t;
	}

	async #poll(): Promise<void> {
		if (this.#disposed || this.#listeners.size === 0) return;
		try {
			const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
			const next = new Map<string, string>();
			for (const { refname, oid } of refs) next.set(refname, oid);
			await this.#diffAndEmit(this.#lastSnapshot, next);
			this.#lastSnapshot = next;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[ordna-namespace] poll failed: ${msg}`);
		} finally {
			if (!this.#disposed && this.#listeners.size > 0) {
				this.#schedulePoll();
			}
		}
	}

	async #diffAndEmit(
		prev: Map<string, string>,
		next: Map<string, string>,
	): Promise<void> {
		// Added: in next, not in prev.
		for (const [refname, oid] of next) {
			if (!prev.has(refname)) {
				const task = await this.#parseRef(refname, oid);
				if (task) this.#emit({ type: "added", task });
				continue;
			}
			if (prev.get(refname) !== oid) {
				const task = await this.#parseRef(refname, oid);
				if (task) this.#emit({ type: "changed", task });
			}
		}
		// Removed: in prev, not in next.
		for (const [refname] of prev) {
			if (!next.has(refname)) {
				// Synthesise a filePath value so the existing TaskEvent
				// shape (which carries filePath on `removed`) still
				// reaches the consumer. A future TaskEvent variant with
				// `id` for namespace-emitted removals would be cleaner;
				// scope-creep for T-032.
				this.#emit({ type: "removed", filePath: refname });
			}
		}
	}

	async #parseRef(refname: string, oid: string): Promise<Task | null> {
		try {
			const raw = await this.#git.catBlob(oid);
			const task = parseTaskBytes(raw, `ref:${refname}`);
			delete task.filePath;
			return task;
		} catch {
			return null;
		}
	}

	#emit(event: TaskEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ordna-namespace] listener threw: ${msg}`);
			}
		}
	}
}

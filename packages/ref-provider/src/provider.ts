import {
	type ListOptions,
	type OrdnaConfig,
	type Task,
	type TaskCreateInput,
	type TaskEventListener,
	type TaskProvider,
	type TaskUpdateInput,
	defaultSectionsFor,
	formatId,
	parseId,
	parseTask,
	serializeTask,
} from "@frehilm/ordna-core";
import { GitRunner } from "./git.js";

const REF_PREFIX = "refs/ordna/tasks/";
const DEFAULT_POLL_MS = 1000;
const ARCHIVED_STATUS = "archived";

interface RefConfig {
	pollIntervalMs: number;
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Store one blob per task at `refs/ordna/tasks/<id>`. The blob content
 * is the same markdown + frontmatter the file provider writes, so
 * tasks can be round-tripped between modes if a user ever migrates.
 *
 * No file ever appears in the working tree. `git status` stays
 * untouched by ordna; `git log` on regular branches doesn't see task
 * mutations either (refs/ordna/tasks/* aren't reachable from heads).
 */
export class RefTaskProvider implements TaskProvider {
	readonly kind = "ref";

	private readonly git: GitRunner;
	private readonly refConfig: RefConfig;
	private active = true;

	// Watch state — polling only. Refs don't have a kernel notification
	// path; watching `.git/refs/` directly breaks the moment refs get
	// packed. Polling at 1s is reliable and cheap (a single
	// `git for-each-ref` call per tick).
	private readonly listeners = new Set<TaskEventListener>();
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private lastSnapshot = new Map<string, { oid: string; task: Task }>();

	constructor(
		private readonly config: OrdnaConfig,
		cwd: string,
	) {
		this.git = new GitRunner(cwd);
		this.refConfig = parseRefConfig(config);
	}

	async init(): Promise<void> {
		// Backlog compatibility is documented as unsupported — the
		// ref-shaped filename ("task-1 - title.md") has no meaning when
		// there's no filesystem to host it. Fail fast so the user knows
		// before any data lands.
		if (this.config.schema === "backlog") {
			throw new Error(
				"ordna-ref: `schema: backlog` is not supported with `provider: ref`. Backlog filenames have no analogue in a ref-only store; use `schema: ordna` (the default) or switch to `provider: file`.",
			);
		}
		await this.git.ensureRepository();
	}

	async dispose(): Promise<void> {
		this.active = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		this.listeners.clear();
		this.lastSnapshot.clear();
	}

	// ---------------- reads ----------------

	async list(options: ListOptions = {}): Promise<Task[]> {
		const refs = await this.git.forEachRef(`${REF_PREFIX}*`);
		const tasks: Task[] = [];
		for (const { refname, oid } of refs) {
			const id = idFromRef(refname);
			if (!id) continue;
			try {
				const raw = await this.git.catBlob(oid);
				tasks.push(this.parseStored(raw, id));
			} catch {
				// Skip unreadable / corrupt blobs silently — same posture
				// as file provider toward malformed files.
			}
		}
		let filtered = tasks;
		if (options.status) filtered = filtered.filter((t) => t.status === options.status);
		if (options.assignee) {
			const a = options.assignee;
			filtered = filtered.filter((t) => t.assignee === a);
		}
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
		const refname = `${REF_PREFIX}${id}`;
		const refs = await this.git.forEachRef(refname);
		const match = refs.find((r) => r.refname === refname);
		if (!match) return null;
		const raw = await this.git.catBlob(match.oid);
		return this.parseStored(raw, id);
	}

	// ---------------- writes ----------------

	async create(input: TaskCreateInput): Promise<Task> {
		const id = await this.allocateId();
		const status = input.status ?? this.config.statuses[0];
		if (!status) throw new Error("ordna-ref: config has no statuses defined");
		if (!isKnownStatus(this.config, status)) {
			throw new Error(`Status "${status}" is not in configured statuses.`);
		}

		const now = todayIso();
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
		};
		const serialized = serializeTask(task, this.config.schema);
		task.rawContent = serialized;
		const oid = await this.git.hashObject(serialized);
		// Compare-and-swap: ref must not exist yet. Passing the empty
		// string as expected-old tells git "the ref must currently be
		// absent" — protects against accidental ID re-use when two
		// machines allocate the same number offline.
		try {
			await this.git.updateRef(`${REF_PREFIX}${id}`, oid, "");
		} catch (err) {
			const message = (err as Error).message;
			throw new Error(
				`ordna-ref: failed to create ${id} — ${message}. Another machine may have written this ID already; pull (\`git fetch origin '+refs/ordna/tasks/*:refs/ordna/tasks/*'\`) and retry.`,
			);
		}
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
		const refname = `${REF_PREFIX}${id}`;
		const refs = await this.git.forEachRef(refname);
		const match = refs.find((r) => r.refname === refname);
		if (!match) throw new Error(`Task ${id} not found.`);
		const existing = this.parseStored(await this.git.catBlob(match.oid), id);

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
			updated_at: todayIso(),
		};
		if (
			next.status !== existing.status &&
			!isKnownStatus(this.config, next.status)
		) {
			throw new Error(`Status "${next.status}" is not in configured statuses.`);
		}

		const serialized = serializeTask(next, this.config.schema);
		next.rawContent = serialized;
		const newOid = await this.git.hashObject(serialized);
		// Compare-and-swap: the ref must currently be at match.oid. If
		// someone else updated it between our read and write, git fails
		// here and we surface the error. The user re-reads and retries.
		try {
			await this.git.updateRef(refname, newOid, match.oid);
		} catch (err) {
			const message = (err as Error).message;
			throw new Error(
				`ordna-ref: ${id} moved underneath us — ${message}. Someone else updated this task while you were editing; refresh (\`ordna show ${id}\`) and retry.`,
			);
		}
		return next;
	}

	async move(id: string, status: string): Promise<Task> {
		return this.update(id, { status });
	}

	async delete(id: string): Promise<void> {
		const refname = `${REF_PREFIX}${id}`;
		const refs = await this.git.forEachRef(refname);
		const match = refs.find((r) => r.refname === refname);
		if (!match) throw new Error(`Task ${id} not found.`);
		await this.git.deleteRef(refname, match.oid);
	}

	// ---------------- watch ----------------

	watch(listener: TaskEventListener): () => Promise<void> {
		this.listeners.add(listener);
		// Seed snapshot once on the first subscription so the initial
		// poll doesn't classify existing tasks as `added`.
		if (this.listeners.size === 1 && this.lastSnapshot.size === 0) {
			void this.seedSnapshot().then(() => {
				if (this.active && this.listeners.size > 0) this.schedulePoll();
			});
		} else if (this.active && this.pollTimer === null) {
			this.schedulePoll();
		}
		return async () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0 && this.pollTimer !== null) {
				clearTimeout(this.pollTimer);
				this.pollTimer = null;
			}
		};
	}

	// ---------------- commit ----------------

	/**
	 * Tasks live outside the working tree, so there's nothing for git
	 * to "commit" in the regular sense. We intentionally implement
	 * `commit` as a no-op rather than aliasing it to a push: pushing on
	 * every CLI invocation would be too eager and surprise users with
	 * unexpected network calls. Sync is a separate, explicit step.
	 *
	 * Users who want sync should configure a refspec once:
	 *
	 *   git config --add remote.origin.push '+refs/ordna/tasks/*:refs/ordna/tasks/*'
	 *   git config --add remote.origin.fetch '+refs/ordna/tasks/*:refs/ordna/tasks/*'
	 *
	 * After that, plain `git push` / `git fetch` sync tasks alongside
	 * branches.
	 */
	async commit(_message?: string): Promise<void> {
		// Intentional no-op. See doc comment above.
	}

	// ---------------- internals ----------------

	private parseStored(raw: string, id: string): Task {
		// parseTask wants a filePath; use a synthetic one so the field
		// is non-empty (some UI code prefers a non-empty value to
		// render). Mark it clearly so nothing tries to fs.readFile it.
		const task = parseTask(raw, `ref:${id}`);
		// Strip the synthetic filePath so callers don't mistake it for
		// a real disk path. UI code already null-guards this field.
		delete task.filePath;
		return task;
	}

	private async allocateId(): Promise<string> {
		const refs = await this.git.forEachRef(`${REF_PREFIX}*`);
		let max = 0;
		for (const { refname } of refs) {
			const id = idFromRef(refname);
			if (!id) continue;
			const n = parseId(this.config, id);
			if (n !== null && n > max) max = n;
		}
		return formatId(this.config, max + 1);
	}

	private async snapshot(): Promise<Map<string, { oid: string; task: Task }>> {
		const refs = await this.git.forEachRef(`${REF_PREFIX}*`);
		const out = new Map<string, { oid: string; task: Task }>();
		for (const { refname, oid } of refs) {
			const id = idFromRef(refname);
			if (!id) continue;
			try {
				const raw = await this.git.catBlob(oid);
				out.set(id, { oid, task: this.parseStored(raw, id) });
			} catch {
				// skip unreadable
			}
		}
		return out;
	}

	private async seedSnapshot(): Promise<void> {
		try {
			this.lastSnapshot = await this.snapshot();
		} catch {
			// best-effort — next poll will retry
		}
	}

	private schedulePoll(): void {
		this.pollTimer = setTimeout(() => {
			void this.poll();
		}, this.refConfig.pollIntervalMs);
		// Don't keep the Node process alive just for the poll timer.
		if (this.pollTimer && typeof this.pollTimer === "object") {
			(this.pollTimer as { unref?: () => void }).unref?.();
		}
	}

	private async poll(): Promise<void> {
		if (!this.active || this.listeners.size === 0) {
			this.pollTimer = null;
			return;
		}
		try {
			const next = await this.snapshot();
			this.diffAndEmit(next);
			this.lastSnapshot = next;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[ordna-ref] poll failed: ${message}`);
		} finally {
			if (this.active && this.listeners.size > 0) this.schedulePoll();
			else this.pollTimer = null;
		}
	}

	private diffAndEmit(
		next: Map<string, { oid: string; task: Task }>,
	): void {
		for (const [id, entry] of next) {
			const prev = this.lastSnapshot.get(id);
			if (!prev) {
				this.emit({ type: "added", task: entry.task });
				continue;
			}
			if (prev.oid !== entry.oid) {
				this.emit({ type: "changed", task: entry.task });
			}
		}
		for (const [id, prev] of this.lastSnapshot) {
			if (!next.has(id)) {
				this.emit({
					type: "removed",
					id,
					filePath: prev.task.filePath ?? "",
				});
			}
		}
	}

	private emit(event: Parameters<TaskEventListener>[0]): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[ordna-ref] listener threw: ${message}`);
			}
		}
	}
}

function idFromRef(refname: string): string | null {
	if (!refname.startsWith(REF_PREFIX)) return null;
	const id = refname.slice(REF_PREFIX.length);
	return id.length > 0 ? id : null;
}

function isKnownStatus(config: OrdnaConfig, status: string): boolean {
	if (status === ARCHIVED_STATUS) return true;
	return config.statuses.includes(status);
}

function parseRefConfig(config: OrdnaConfig): RefConfig {
	const raw = (config as unknown as { ref?: unknown }).ref;
	let pollIntervalMs = DEFAULT_POLL_MS;
	if (raw && typeof raw === "object") {
		const r = raw as Record<string, unknown>;
		if (typeof r.pollIntervalMs === "number" && r.pollIntervalMs > 0) {
			pollIntervalMs = r.pollIntervalMs;
		}
	}
	return { pollIntervalMs };
}

import type { OrdnaConfig } from "../../config.js";
import { parseId } from "../../ids.js";
import type { Attachment, Task, TaskCreateInput, TaskUpdateInput } from "../../schema.js";
import type { TaskEvent, TaskEventListener } from "../../watcher.js";
import { inferMediaType, nextAttachmentId, sanitizeFilename } from "../attachments.js";
import {
	ARCHIVED_STATUS,
	type AttachmentInput,
	type AttachmentStore,
	type Backend,
	type FetchResult,
	type ListOptions,
	isKnownStatus,
} from "../backend.js";
import { GitRunner } from "../git-ref.js";
import { defaultSectionsFor, parseTaskBytes, serializeTask } from "../markdown.js";
import { type Op, SyncRef } from "../sync-ref.js";

const REF_PREFIX = "refs/ordna/tasks/";
const TASK_REF_PATTERN = `${REF_PREFIX}*`;
const NAMESPACE_FETCH_REFSPEC = `+${REF_PREFIX}*:${REF_PREFIX}*`;
// Attachment blobs are anchored by one ref each at
// refs/ordna/attachments/<taskId>/<attId> so they survive `git gc` and
// ride the same push/fetch path as tasks.
const ATT_REF_PREFIX = "refs/ordna/attachments/";
const ATT_FETCH_REFSPEC = `+${ATT_REF_PREFIX}*:${ATT_REF_PREFIX}*`;
const STATE_REF_NAME = "refs/ordna/state";
const STATE_PUSH_REFSPEC = `+${STATE_REF_NAME}:${STATE_REF_NAME}`;
const STATE_FETCH_REFSPEC = `+${STATE_REF_NAME}:${STATE_REF_NAME}`;
const PUSH_DEBOUNCE_MS = 50;
// Sentinel refname used internally to schedule the state ref push.
const STATE_PUSH_SENTINEL = STATE_REF_NAME;

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
	return new Date().toISOString();
}

function refnameFor(id: string): string {
	return `${REF_PREFIX}${id}`;
}

function idFromRefname(refname: string): string | null {
	if (!refname.startsWith(REF_PREFIX)) return null;
	const id = refname.slice(REF_PREFIX.length);
	return id.length > 0 ? id : null;
}

function attRefnameFor(taskId: string, attId: string): string {
	return `${ATT_REF_PREFIX}${taskId}/${attId}`;
}

/** Strip the `git:` scheme from an attachment `src` to get the blob oid. */
function oidFromSrc(src: string): string {
	return src.startsWith("git:") ? src.slice("git:".length) : src;
}

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
 * Heuristic: detect a push rejection from the thrown git error. Covers
 * the three flavours we care about:
 *  - `[rejected] ... (stale info)` — `--force-with-lease` denied
 *  - `[rejected] ... (non-fast-forward)` — plain refused update
 *  - `[rejected] ... (fetch first)` — same family
 *
 * Network failures and auth errors fall through to the generic logger.
 */
function isPushRejection(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return (
		msg.includes("rejected") ||
		msg.includes("stale info") ||
		msg.includes("non-fast-forward") ||
		msg.includes("fetch first")
	);
}

interface PendingPush {
	refname: string;
	/** Local OID we want pushed. Empty string for state-ref sentinel. */
	newOid: string;
	/**
	 * The OID the remote should currently hold for the lease to pass.
	 * Empty string asserts the ref must not yet exist on the remote.
	 */
	expectedOld: string;
	/**
	 * True if this push asserts the ref doesn't exist remotely (the
	 * create case). Only creates can be auto-renumbered on collision.
	 */
	isCreate: boolean;
}

/**
 * Namespace storage backend.
 *
 * Tasks live as git **blobs** under `refs/ordna/tasks/<id>` — one ref
 * per task, no working-tree files. `git status` stays clean. `git log`
 * on branches doesn't see task mutations.
 *
 * **ID allocation.** A shared `refs/ordna/state` ref carries a
 * `SyncRef`-managed JSON blob `{next_id, ops}`. Same primitive as
 * hybrid: CAS in-process, auto-fetch-and-retry on conflict.
 *
 * **Bootstrap.** On `init()` if the state ref is missing, we scan
 * existing `refs/ordna/tasks/*` and seed `next_id` from the max
 * numeric id. Safe across concurrent processes (CAS).
 *
 * **Sync.** Every mutation schedules a per-ref push with
 * `--force-with-lease` (per-ref CAS at the protocol level). On a
 * rejected `create` (offline collision), the backend fetches,
 * reallocates a fresh id via `SyncRef`, rewrites the local blob's
 * `id:` field, cascades the rewrite through any local `depends_on`
 * references to the old id, and emits a `renamed` event. Update
 * collisions are deliberately loud — silently picking a winner would
 * lose user edits.
 *
 * **Auto-fetch.** A configurable timer (default 60s) keeps the local
 * snapshot fresh without manual pulls. A `fetch()` method exposes it
 * manually for the TUI key / web button.
 *
 * **Audit log.** The `ops` array in the state blob records every
 * `create`/`update`/`archive`/`delete`/`rename`. `rename` entries
 * carry `renamedFrom` so the UIs can show a "previously known as X"
 * banner on the affected task.
 */
export class NamespaceBackend implements Backend {
	readonly kind = "namespace";
	readonly attachments: AttachmentStore;

	#initPromise: Promise<void> | null = null;
	readonly #git: GitRunner;
	#sync: SyncRef | null = null;
	#cachedActor: string | null = null;

	// Push pipeline (replaces the simple PushQueue used in earlier T-032).
	#pendingPushes = new Map<string, PendingPush>();
	#pushTimer: ReturnType<typeof setTimeout> | null = null;
	#pushInFlight: Promise<void> | null = null;
	#pushRetryPending = false;

	// Watcher (poll-based, refs have no kernel-level change notification).
	#pollTimer: ReturnType<typeof setTimeout> | null = null;
	#listeners = new Set<TaskEventListener>();
	#lastSnapshot = new Map<string, string>();
	#pollIntervalMs: number;

	// Auto-fetch (60s by default; 0 disables).
	#autoFetchIntervalMs: number;
	#autoFetchTimer: ReturnType<typeof setTimeout> | null = null;
	#autoFetchInFlight: Promise<FetchResult> | null = null;

	#remoteChecked = false;
	#remoteExists = false;
	#disposed = false;
	#autoRenumberOnConflict: boolean;

	constructor(
		private readonly cwd: string,
		private readonly config: OrdnaConfig,
	) {
		this.#git = new GitRunner(cwd);
		this.#pollIntervalMs = config.namespace?.pollIntervalMs ?? 1000;
		this.#autoFetchIntervalMs = config.namespace?.autoFetchIntervalMs ?? 60000;
		this.#autoRenumberOnConflict = config.namespace?.autoRenumberOnConflict ?? true;
		this.attachments = {
			add: (taskId, input) => this.#attachmentAdd(taskId, input),
			read: (taskId, attId) => this.#attachmentRead(taskId, attId),
			remove: (taskId, attId) => this.#attachmentRemove(taskId, attId),
		};
	}

	async init(): Promise<void> {
		await this.#git.ensureRepository();
		this.#sync = new SyncRef(this.#git, STATE_REF_NAME);
		await this.#bootstrapStateIfMissing();
		if (this.#autoFetchIntervalMs > 0) {
			this.#scheduleAutoFetch();
		}
	}

	async #bootstrapStateIfMissing(): Promise<void> {
		const sync = this.#sync as SyncRef;
		// Compute the high-water mark from existing task refs so an upgrade
		// from a pre-state-ref namespace install (or a fresh clone before
		// the state ref was pushed) gets the correct next_id.
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		let maxNumeric = 0;
		for (const { refname } of refs) {
			const id = idFromRefname(refname);
			if (!id) continue;
			const n = parseId(this.config, id);
			if (n !== null && n > maxNumeric) maxNumeric = n;
		}
		// ensureInitialized only writes if the state ref doesn't yet exist
		// (CAS with empty expected). If two processes race, one wins and
		// the other adopts.
		await sync.ensureInitialized({
			next_id: maxNumeric + 1,
			ops: [],
		});
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
		if (this.#autoFetchTimer) {
			clearTimeout(this.#autoFetchTimer);
			this.#autoFetchTimer = null;
		}
		if (this.#autoFetchInFlight) {
			try {
				await this.#autoFetchInFlight;
			} catch {
				// already logged in #runAutoFetch
			}
		}
		// Flush any pending pushes so the last mutation lands on origin
		// before the process exits. flushPushes cancels the debounce
		// timer itself; we leave #pushTimer alone here so it can hand
		// the pending batch to the flusher.
		await this.#flushPushes();
		this.#listeners.clear();
		this.#lastSnapshot.clear();
	}

	// ---------------- reads ----------------

	async list(options: ListOptions = {}): Promise<Task[]> {
		await this.#ensureInit();
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		const renamedMap = await this.#buildRenamedFromMap();
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
				const renamedFrom = renamedMap.get(id);
				if (renamedFrom) task.renamed_from = renamedFrom;
				tasks.push(task);
			} catch {
				// Skip unreadable / malformed blobs silently.
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
		await this.#ensureInit();
		const refname = refnameFor(id);
		const refs = await this.#git.forEachRef(refname);
		const entry = refs.find((r) => r.refname === refname);
		if (!entry) return null;
		try {
			const raw = await this.#git.catBlob(entry.oid);
			const task = parseTaskBytes(raw, `ref:${refname}`);
			delete task.filePath;
			const renamedFrom = await this.#lookupRenamedFrom(id);
			if (renamedFrom) task.renamed_from = renamedFrom;
			return task;
		} catch {
			return null;
		}
	}

	// ---------------- writes ----------------

	async create(input: TaskCreateInput): Promise<Task> {
		await this.#ensureInit();
		const sync = this.#sync as SyncRef;

		const status = input.status ?? this.config.statuses[0];
		if (!status) throw new Error("Config has no statuses defined.");
		if (!isKnownStatus(this.config, status)) {
			throw new Error(`Status "${status}" is not in configured statuses.`);
		}

		// Allocate via SyncRef — CAS-retries on conflict, auto-fetches the
		// state ref from origin before retry.
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
			rawContent: "",
		};
		const serialized = serializeTask(task, this.config.schema);
		task.rawContent = serialized;

		// hash-object first — blob is durable in .git/objects/ from here;
		// any subsequent failure leaves an orphan, recoverable until the
		// next `git gc --prune`.
		const newOid = await this.#git.hashObject(serialized);

		// CAS update-ref with empty expected-old. Belt-and-braces: SyncRef
		// just handed us a fresh id, so a local collision means the state
		// ref is out of sync with reality. We surface that loudly rather
		// than silently mask it.
		try {
			await this.#git.updateRef(refnameFor(id), newOid, "");
		} catch (err) {
			if (isCASConflict(err)) {
				throw new Error(
					`ordna: ${id} already exists locally despite a fresh allocation. State ref may be out of sync — try \`git update-ref -d ${STATE_REF_NAME}\` and retry; the next init() will reseed from existing task refs.`,
				);
			}
			throw err;
		}

		await sync.appendOp(await this.#buildOp("create", id));
		this.#schedulePush({
			refname: refnameFor(id),
			newOid,
			expectedOld: "",
			isCreate: true,
		});
		this.#schedulePushState();
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
		await this.#ensureInit();
		const sync = this.#sync as SyncRef;

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

		// Light op classification: archive transitions get their own kind;
		// everything else is a generic update. Mirrors hybrid.
		const opKind: Op["op"] = patch.status === ARCHIVED_STATUS ? "archive" : "update";
		await sync.appendOp(await this.#buildOp(opKind, id));
		this.#schedulePush({
			refname,
			newOid,
			expectedOld: currentOid,
			isCreate: false,
		});
		this.#schedulePushState();
		return next;
	}

	async delete(id: string): Promise<void> {
		await this.#ensureInit();
		const sync = this.#sync as SyncRef;

		const refname = refnameFor(id);
		const refs = await this.#git.forEachRef(refname);
		const entry = refs.find((r) => r.refname === refname);
		if (!entry) throw new Error(`Task ${id} not found.`);
		const oldOid = entry.oid;
		try {
			await this.#git.deleteRef(refname, oldOid);
		} catch (err) {
			if (isCASConflict(err)) {
				throw new Error(
					`ordna: ${id} moved underneath us before delete. Another writer changed this task; pull and retry.`,
				);
			}
			throw err;
		}

		await sync.appendOp(await this.#buildOp("delete", id));

		// Don't orphan the task's attachment anchor refs — without this
		// the blobs stay pinned (GC-immune) locally and on origin forever.
		// Collected before the remote block so the delete-pushes below can
		// cover them too. Best-effort per ref: a ref that moved underneath
		// us is skipped rather than blocking the task delete.
		const attRefs = await this.#git.forEachRef(`${ATT_REF_PREFIX}${id}/*`);
		for (const att of attRefs) {
			try {
				await this.#git.deleteRef(att.refname, att.oid);
			} catch {
				// moved / already gone — skip
			}
		}

		// Delete-push with lease so we don't clobber an in-flight remote
		// update. Soft-fail like the other push paths — the local delete
		// has already happened; a rejection just means the remote has
		// diverged and the user needs to reconcile.
		await this.#checkRemote();
		if (this.#remoteExists) {
			try {
				await this.#git.run([
					"push",
					`--force-with-lease=${refname}:${oldOid}`,
					"origin",
					`:${refname}`,
				]);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ordna-namespace] delete-push for ${refname} failed: ${msg}`);
			}
			for (const att of attRefs) {
				try {
					await this.#git.run([
						"push",
						`--force-with-lease=${att.refname}:${att.oid}`,
						"origin",
						`:${att.refname}`,
					]);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(
						`[ordna-namespace] attachment delete-push for ${att.refname} failed: ${msg}`,
					);
				}
			}
		}
		this.#schedulePushState();
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

	// ---------------- fetch ----------------

	async fetch(): Promise<FetchResult> {
		await this.#ensureInit();
		const start = Date.now();
		await this.#checkRemote();
		if (!this.#remoteExists) return { refsUpdated: 0, durationMs: 0 };

		const before = await this.#snapshotRefs();
		// Fetch task refs and the state ref. State ref may not yet exist
		// on origin (mixed-version teams); ignore that failure.
		await this.#git.fetchRefspec(NAMESPACE_FETCH_REFSPEC);
		try {
			await this.#git.fetchRefspec(ATT_FETCH_REFSPEC);
		} catch {
			// no attachment refs on origin yet — fine
		}
		try {
			await this.#git.fetchRefspec(STATE_FETCH_REFSPEC);
		} catch {
			// remote doesn't have the state ref yet — fine
		}
		if (this.#sync) this.#sync.invalidate();
		const after = await this.#snapshotRefs();
		const changed = this.#countRefDiff(before, after);
		return { refsUpdated: changed, durationMs: Date.now() - start };
	}

	// ---------------- attachments ----------------

	async #attachmentAdd(taskId: string, input: AttachmentInput): Promise<Attachment> {
		await this.#ensureInit();
		const existing = await this.get(taskId);
		if (!existing) throw new Error(`Task ${taskId} not found.`);

		const id = nextAttachmentId(existing.attachments);
		const name = sanitizeFilename(input.name);

		// Write the bytes as a blob and anchor it with a ref so `git gc`
		// can't prune it. The ref name is unique (attId is max+1), so the
		// empty-expected CAS asserts a genuine create.
		const oid = await this.#git.hashObjectBuffer(input.bytes);
		const attRef = attRefnameFor(taskId, id);
		await this.#git.updateRef(attRef, oid, "");

		const att: Attachment = {
			id,
			name,
			type: input.type ?? inferMediaType(name),
			size: input.bytes.byteLength,
			added: today(),
			src: `git:${oid}`,
		};

		await this.#mutateAttachments(taskId, (atts) => [...atts, att]);

		// Push the anchor ref alongside the task blob. isCreate:false keeps
		// it off the renumber path — blobs are content-addressed, so a
		// same-name collision means identical bytes (harmless).
		this.#schedulePush({
			refname: attRef,
			newOid: oid,
			expectedOld: "",
			isCreate: false,
		});
		return att;
	}

	async #attachmentRead(
		taskId: string,
		attId: string,
	): Promise<{ meta: Attachment; bytes: Buffer }> {
		await this.#ensureInit();
		const task = await this.get(taskId);
		if (!task) throw new Error(`Task ${taskId} not found.`);
		const meta = task.attachments.find((a) => a.id === attId);
		if (!meta) {
			throw new Error(`Attachment ${attId} not found on ${taskId}.`);
		}
		const bytes = await this.#git.catBlobBuffer(oidFromSrc(meta.src));
		return { meta, bytes };
	}

	async #attachmentRemove(taskId: string, attId: string): Promise<void> {
		await this.#ensureInit();
		const task = await this.get(taskId);
		if (!task) throw new Error(`Task ${taskId} not found.`);
		const meta = task.attachments.find((a) => a.id === attId);
		if (!meta) {
			throw new Error(`Attachment ${attId} not found on ${taskId}.`);
		}

		// Drop the anchor ref (best-effort) so the blob becomes
		// GC-eligible, then update the task registry.
		const attRef = attRefnameFor(taskId, attId);
		const refs = await this.#git.forEachRef(attRef);
		const entry = refs.find((r) => r.refname === attRef);
		if (entry) {
			try {
				await this.#git.deleteRef(attRef, entry.oid);
			} catch {
				// ref moved/gone — the registry removal below is what matters
			}
		}

		await this.#mutateAttachments(taskId, (atts) => atts.filter((a) => a.id !== attId));

		// Mirror task-delete: best-effort delete-push of the anchor ref.
		await this.#checkRemote();
		if (this.#remoteExists && entry) {
			try {
				await this.#git.run([
					"push",
					`--force-with-lease=${attRef}:${entry.oid}`,
					"origin",
					`:${attRef}`,
				]);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ordna-namespace] attachment delete-push for ${attRef} failed: ${msg}`);
			}
		}
	}

	/**
	 * CAS-rewrite a task blob with a transformed `attachments` list.
	 * Same read-modify-write-with-lease shape as `update()`; appends an
	 * audit op and schedules the task + state pushes.
	 */
	async #mutateAttachments(
		taskId: string,
		transform: (atts: Attachment[]) => Attachment[],
	): Promise<void> {
		const sync = this.#sync as SyncRef;
		const refname = refnameFor(taskId);
		const refs = await this.#git.forEachRef(refname);
		const entry = refs.find((r) => r.refname === refname);
		if (!entry) throw new Error(`Task ${taskId} not found.`);
		const currentOid = entry.oid;

		const raw = await this.#git.catBlob(currentOid);
		const task = parseTaskBytes(raw, `ref:${refname}`);
		delete task.filePath;

		const next: Task = {
			...task,
			attachments: transform(task.attachments),
			updated_at: today(),
		};
		const serialized = serializeTask(next, this.config.schema);
		const newOid = await this.#git.hashObject(serialized);
		try {
			await this.#git.updateRef(refname, newOid, currentOid);
		} catch (err) {
			if (isCASConflict(err)) {
				throw new Error(
					`ordna: ${taskId} moved underneath us while updating attachments; pull (\`git fetch origin '+${refname}:${refname}'\`) and retry.`,
				);
			}
			throw err;
		}

		await sync.appendOp(await this.#buildOp("update", taskId));
		this.#schedulePush({
			refname,
			newOid,
			expectedOld: currentOid,
			isCreate: false,
		});
		this.#schedulePushState();
	}

	// ---------------- internals: push pipeline ----------------

	#schedulePush(push: PendingPush): void {
		// Coalesce per refname: keep the original expectedOld (the value
		// the remote has when we first scheduled), update newOid to the
		// latest. isCreate stays as captured on first schedule — if a
		// create+update happen back-to-back without a flush, the remote
		// still sees "this ref didn't exist; now it does."
		const existing = this.#pendingPushes.get(push.refname);
		if (existing && existing.refname !== STATE_PUSH_SENTINEL) {
			existing.newOid = push.newOid;
		} else {
			this.#pendingPushes.set(push.refname, { ...push });
		}
		this.#armPushTimer();
	}

	#schedulePushState(): void {
		this.#pendingPushes.set(STATE_PUSH_SENTINEL, {
			refname: STATE_PUSH_SENTINEL,
			newOid: "",
			expectedOld: "",
			isCreate: false,
		});
		this.#armPushTimer();
	}

	#armPushTimer(): void {
		if (this.#pushTimer) clearTimeout(this.#pushTimer);
		const t = setTimeout(() => {
			this.#pushTimer = null;
			void this.#drainPushes();
		}, PUSH_DEBOUNCE_MS);
		// Don't keep the Node process alive on the push timer alone —
		// host owns lifetime, dispose() flushes anything pending.
		(t as unknown as { unref?: () => void }).unref?.();
		this.#pushTimer = t;
	}

	async #drainPushes(): Promise<void> {
		if (this.#pushInFlight) {
			this.#pushRetryPending = true;
			return;
		}
		this.#pushInFlight = this.#runPushBatch().finally(() => {
			this.#pushInFlight = null;
			if (this.#pushRetryPending) {
				this.#pushRetryPending = false;
				void this.#drainPushes();
			}
		});
	}

	async #runPushBatch(): Promise<void> {
		await this.#checkRemote();
		if (!this.#remoteExists) {
			this.#pendingPushes.clear();
			return;
		}

		// Take the current batch; new schedules accumulate into the next.
		const batch = Array.from(this.#pendingPushes.values());
		this.#pendingPushes.clear();

		// State ref push first — best-effort, force is fine since SyncRef
		// has CAS-managed the ref in-process already.
		const stateInBatch = batch.find((p) => p.refname === STATE_PUSH_SENTINEL);
		if (stateInBatch) {
			try {
				await this.#git.pushRef(STATE_PUSH_REFSPEC);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[ordna-namespace] state push failed: ${msg}`);
			}
		}

		// Task ref pushes with per-ref leases. We don't bail on first
		// rejection — each ref is reconciled independently so a single
		// collision doesn't block the rest.
		for (const push of batch) {
			if (push.refname === STATE_PUSH_SENTINEL) continue;
			await this.#pushTaskRef(push);
		}
	}

	async #pushTaskRef(push: PendingPush): Promise<void> {
		try {
			await this.#git.pushRefWithLease(push.refname, push.newOid, push.expectedOld);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!isPushRejection(err)) {
				console.error(`[ordna-namespace] push failed for ${push.refname}: ${msg}`);
				return;
			}
			if (push.isCreate && this.#autoRenumberOnConflict) {
				await this.#reconcileCreateCollision(push);
			} else {
				// Update collision (or auto-renumber disabled). Loud.
				console.error(
					`[ordna-namespace] push rejected for ${push.refname}; remote has diverged. Run \`git fetch origin '+${push.refname}:${push.refname}'\` and reconcile manually.`,
				);
			}
		}
	}

	/**
	 * Push of a `create` was rejected because the remote already has
	 * this id (another offline writer landed it first). Recover by:
	 *
	 *   1. Fetching origin (so our local refs reflect the remote winner).
	 *   2. Reading the blob we tried to push (we still have the OID).
	 *   3. Allocating a fresh id via SyncRef.
	 *   4. Re-serialising with the new id, writing a new ref.
	 *   5. Cascading the rewrite through any local `depends_on`
	 *      references to the old id.
	 *   6. Logging a `rename` op (with `renamedFrom`) in the audit log.
	 *   7. Scheduling the new refs for push.
	 *   8. Emitting a `renamed` event so the UI can toast + show the
	 *      "previously known as X" banner.
	 */
	async #reconcileCreateCollision(push: PendingPush): Promise<void> {
		const sync = this.#sync as SyncRef;
		const oldId = idFromRefname(push.refname);
		if (!oldId) return;

		try {
			// 1. Fetch — our local copy of `push.refname` will be clobbered
			//    by the remote's value (that's fine; we abandon the local
			//    write of that ref and recreate under a new id).
			await this.#git.fetchRefspec(NAMESPACE_FETCH_REFSPEC);
			try {
				await this.#git.fetchRefspec(STATE_FETCH_REFSPEC);
			} catch {
				// state ref may not exist on origin yet
			}
			sync.invalidate();

			// 2. Read the blob we wanted to push. push.newOid is the OID
			//    we hashed locally; the blob still exists in .git/objects/
			//    even though the ref no longer points at it.
			const ourBlob = await this.#git.catBlob(push.newOid);
			const ourTask = parseTaskBytes(ourBlob, `ref:${push.refname}`);
			delete ourTask.filePath;

			// 3. Allocate a fresh id. After the fetch, the SyncRef cache
			//    has been invalidated and a new read reflects the merged
			//    remote+local view of `next_id`. The allocator may still
			//    hand us an id that's taken by a *different* local task
			//    (e.g. A had T-001 + T-002 local, T-001 collided, state
			//    says next_id=2 but T-002 is locally occupied). Loop until
			//    we get a genuinely free slot — burning ids is fine, they
			//    are cheap.
			let newId = await sync.allocateNextId(this.config);
			for (let attempt = 0; attempt < 100; attempt++) {
				const existing = await this.#git.forEachRef(refnameFor(newId));
				if (existing.find((r) => r.refname === refnameFor(newId)) === undefined) {
					break;
				}
				newId = await sync.allocateNextId(this.config);
			}

			// 4. Re-serialise with the new id.
			const renamed: Task = {
				...ourTask,
				id: newId,
				updated_at: today(),
			};
			const renamedSerialized = serializeTask(renamed, this.config.schema);
			renamed.rawContent = renamedSerialized;
			const renamedOid = await this.#git.hashObject(renamedSerialized);
			await this.#git.updateRef(refnameFor(newId), renamedOid, "");

			// 5. Cascade. Any local task whose depends_on referenced oldId
			//    gets rewritten to newId. Naive sweep — accepts rare false
			//    positives where a remote teammate's task coincidentally
			//    depended on the colliding id (their content is untouched
			//    locally, so the cascade only catches genuinely-local edits).
			await this.#cascadeDependsOnRewrite(oldId, newId);

			// 6. Audit log.
			await sync.appendOp({
				ts: nowIso(),
				actor: await this.#resolveActor(),
				op: "rename",
				id: newId,
				renamedFrom: oldId,
			});

			// 7. Schedule pushes.
			this.#schedulePush({
				refname: refnameFor(newId),
				newOid: renamedOid,
				expectedOld: "",
				isCreate: true,
			});
			this.#schedulePushState();

			// 8. Notify watchers.
			this.#emit({ type: "renamed", oldId, newId, task: renamed });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[ordna-namespace] reconcile failed for ${push.refname}: ${msg}`);
		}
	}

	async #cascadeDependsOnRewrite(oldId: string, newId: string): Promise<void> {
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		for (const { refname, oid } of refs) {
			const id = idFromRefname(refname);
			if (!id || id === newId) continue;
			try {
				const raw = await this.#git.catBlob(oid);
				const task = parseTaskBytes(raw, `ref:${refname}`);
				delete task.filePath;
				if (!task.depends_on.includes(oldId)) continue;
				const next: Task = {
					...task,
					depends_on: task.depends_on.map((d) => (d === oldId ? newId : d)),
					updated_at: today(),
				};
				const serialized = serializeTask(next, this.config.schema);
				next.rawContent = serialized;
				const newOid = await this.#git.hashObject(serialized);
				try {
					await this.#git.updateRef(refname, newOid, oid);
				} catch {
					// Ref moved underneath the cascade. Skip — the next
					// pass (e.g. on the next mutation) will pick it up
					// if needed; we don't loop here to avoid contention.
					continue;
				}
				this.#schedulePush({
					refname,
					newOid,
					expectedOld: oid,
					isCreate: false,
				});
				this.#emit({ type: "changed", task: next });
			} catch {
				// skip unreadable tasks
			}
		}
	}

	async #flushPushes(): Promise<void> {
		// Cancel the debounce timer so we don't accidentally fire a
		// duplicate drain alongside ours.
		if (this.#pushTimer) {
			clearTimeout(this.#pushTimer);
			this.#pushTimer = null;
		}
		// Kick off a drain now if there's anything queued and nothing
		// already running. Otherwise the in-flight drain (or the empty
		// state) handles it.
		if (this.#pendingPushes.size > 0 && !this.#pushInFlight) {
			void this.#drainPushes();
		}
		// Wait until the pipeline is fully quiet — drains may chain via
		// the retry-pending flag (e.g. a reconcile schedules a new push
		// while the previous batch is running).
		while (this.#pushInFlight) {
			await this.#pushInFlight;
		}
	}

	// ---------------- internals: rename history ----------------

	/**
	 * Walk the audit log in reverse and return a map of `currentId →
	 * mostRecentPreviousId` for every renamed task. Cheap because the
	 * state blob is cached in SyncRef; we re-walk only when the cache
	 * has been invalidated (by a fetch or a CAS conflict).
	 */
	async #buildRenamedFromMap(): Promise<Map<string, string>> {
		const map = new Map<string, string>();
		if (!this.#sync) return map;
		try {
			const state = await this.#sync.read();
			// Walk in reverse so the first hit per id is the most recent.
			for (let i = state.ops.length - 1; i >= 0; i--) {
				const op = state.ops[i];
				if (!op || op.op !== "rename" || !op.renamedFrom) continue;
				if (map.has(op.id)) continue;
				map.set(op.id, op.renamedFrom);
			}
		} catch {
			// State blob unreadable — return empty map; banner just doesn't show.
		}
		return map;
	}

	async #lookupRenamedFrom(id: string): Promise<string | null> {
		if (!this.#sync) return null;
		try {
			const state = await this.#sync.read();
			for (let i = state.ops.length - 1; i >= 0; i--) {
				const op = state.ops[i];
				if (!op || op.op !== "rename" || op.id !== id) continue;
				return op.renamedFrom ?? null;
			}
		} catch {
			// fall through
		}
		return null;
	}

	// ---------------- internals: actor / audit op builder ----------------

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

	// ---------------- internals: watcher poll ----------------

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

	async #diffAndEmit(prev: Map<string, string>, next: Map<string, string>): Promise<void> {
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
		for (const [refname] of prev) {
			if (!next.has(refname)) {
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

	async #checkRemote(): Promise<void> {
		if (this.#remoteChecked) return;
		this.#remoteChecked = true;
		this.#remoteExists = await this.#git.hasRemote();
	}

	async #snapshotRefs(): Promise<Map<string, string>> {
		const refs = await this.#git.forEachRef(TASK_REF_PATTERN);
		const map = new Map<string, string>();
		for (const { refname, oid } of refs) map.set(refname, oid);
		return map;
	}

	#countRefDiff(prev: Map<string, string>, next: Map<string, string>): number {
		let changed = 0;
		for (const [refname, oid] of next) {
			if (prev.get(refname) !== oid) changed++;
		}
		for (const refname of prev.keys()) {
			if (!next.has(refname)) changed++;
		}
		return changed;
	}

	#scheduleAutoFetch(): void {
		if (this.#disposed || this.#autoFetchIntervalMs <= 0) return;
		const t = setTimeout(() => {
			this.#autoFetchTimer = null;
			void this.#runAutoFetch();
		}, this.#autoFetchIntervalMs);
		(t as unknown as { unref?: () => void }).unref?.();
		this.#autoFetchTimer = t;
	}

	async #runAutoFetch(): Promise<void> {
		if (this.#disposed) return;
		try {
			this.#autoFetchInFlight = this.fetch();
			await this.#autoFetchInFlight;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[ordna-namespace] auto-fetch failed: ${msg}`);
		} finally {
			this.#autoFetchInFlight = null;
			if (!this.#disposed) this.#scheduleAutoFetch();
		}
	}
}

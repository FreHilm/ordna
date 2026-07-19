import type { OrdnaConfig } from "../config.js";
import { formatId } from "../ids.js";
import type { GitRunner } from "./git-ref.js";

/**
 * Shape of the JSON blob stored at the sync ref. One blob holds both
 * the allocator high-water mark (next_id) and an append-only audit
 * log of operations. Single blob = single CAS write per mutation.
 */
export interface SyncState {
	/**
	 * Next numeric id to allocate. 1-based; an `allocateNextId` call
	 * returns the formatted id for the current value, then bumps to
	 * `current + 1`.
	 */
	next_id: number;
	/**
	 * Append-only log of operations. Newer entries land at the end.
	 * Schema is intentionally minimal in v1; a follow-up task adds
	 * op-specific fields (from/to for moves, changed-fields for updates,
	 * etc.). Existing entries with fewer fields are forward-compatible.
	 */
	ops: Op[];
}

export interface Op {
	/** ISO-8601 UTC timestamp. */
	ts: string;
	/** Resolved from `git config user.email` with `ORDNA_ACTOR` env fallback, else `"unknown"`. */
	actor: string;
	op: "create" | "update" | "move" | "archive" | "delete" | "rename";
	id: string;
	/**
	 * Present on `rename` ops only: the previous ID before namespace
	 * auto-renumber resolved a push-collision. Powers the
	 * "previously known as X" banner in the UIs. Existing parsers tolerate
	 * the extra field — the JSON shape is forward-compatible.
	 */
	renamedFrom?: string;
}

const DEFAULT_REF = "refs/ordna/state";
const EMPTY_OID = ""; // CAS sentinel for "must not exist"
// Local tracking ref mirroring what we last saw of origin's state ref —
// the expected-old value for lease pushes (same role as a remote-tracking
// branch). Never pushed.
const ORIGIN_TRACK_SUFFIX = "-origin";
// Don't re-fetch origin's state more often than this. Keeps
// fetch-before-allocate from adding a network round-trip to every
// mutation in a burst, while still catching another machine's
// allocations at human pace.
const REMOTE_SYNC_TTL_MS = 5000;

const EMPTY_STATE: SyncState = { next_id: 1, ops: [] };

/**
 * Merge two state blobs from diverged writers: the allocator takes the
 * max (ids are never handed out twice going forward), and the audit
 * logs are unioned (dedup by full-entry identity) in timestamp order.
 */
export function mergeSyncStates(a: SyncState, b: SyncState): SyncState {
	const seen = new Set<string>();
	const ops: Op[] = [];
	for (const op of [...a.ops, ...b.ops]) {
		const key = JSON.stringify(op);
		if (seen.has(key)) continue;
		seen.add(key);
		ops.push(op);
	}
	ops.sort((x, y) => x.ts.localeCompare(y.ts));
	return { next_id: Math.max(a.next_id, b.next_id), ops };
}

function statesEqual(a: SyncState, b: SyncState): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Wraps a single git ref carrying a JSON `SyncState` blob.
 *
 * The CAS pattern: every write reads the current blob, computes the
 * new state, hashes the new blob, and `update-ref`s with the old OID
 * as the expected-old value. If the ref has moved underneath us
 * (another writer slipped in), the CAS fails non-fast-forward and we
 * fetch + retry once. Beyond that, we surface a clear "diverged"
 * error so the user can intervene.
 *
 * Reads are cached in memory until invalidated (after a CAS conflict)
 * or after a successful write (cache is updated to the new state).
 */
export class SyncRef {
	#cached: { oid: string | null; state: SyncState } | null = null;
	/**
	 * Last known oid of origin's state ref (`""` = confirmed absent,
	 * `null` = never looked). The lease value for `pushToOrigin`.
	 */
	#originOid: string | null = null;
	#lastRemoteSyncMs = 0;

	constructor(
		private readonly git: GitRunner,
		readonly refname: string = DEFAULT_REF,
	) {}

	get #originTrackRef(): string {
		return this.refname + ORIGIN_TRACK_SUFFIX;
	}

	/**
	 * Read the current state. Returns an empty state if the ref
	 * doesn't yet exist. Hits the cache when available.
	 */
	async read(): Promise<SyncState> {
		if (this.#cached) return this.#cached.state;
		const fresh = await this.#readUncached();
		this.#cached = fresh;
		return fresh.state;
	}

	/** Drop the cache. Next `read()` hits the ref again. */
	invalidate(): void {
		this.#cached = null;
	}

	/**
	 * Seed the ref with `initial` only if it doesn't yet exist. Used by
	 * namespace mode to migrate pre-state-ref repos: scan existing
	 * `refs/ordna/tasks/*` for the max id, then call this with
	 * `{ next_id: max + 1, ops: [] }`. Safe to call concurrently — if
	 * another process initialises first, we just adopt its value.
	 */
	async ensureInitialized(initial: SyncState): Promise<void> {
		const fresh = await this.#readUncached();
		if (fresh.oid !== null) {
			// Already initialised by someone (us in a previous run, or
			// another process racing with us). Adopt their state.
			this.#cached = fresh;
			return;
		}
		try {
			await this.#writeCAS(null, initial);
		} catch (err) {
			if (isCASConflict(err)) {
				// Lost the bootstrap race; another writer landed first.
				// Re-read to pick up their state.
				this.invalidate();
				await this.read();
				return;
			}
			throw err;
		}
	}

	async #readUncached(): Promise<{ oid: string | null; state: SyncState }> {
		const refs = await this.git.forEachRef(this.refname);
		const match = refs.find((r) => r.refname === this.refname);
		if (!match) return { oid: null, state: structuredClone(EMPTY_STATE) };
		try {
			const raw = await this.git.catBlob(match.oid);
			const parsed = JSON.parse(raw) as SyncState;
			// Defensive normalisation: tolerate missing fields in old blobs.
			return {
				oid: match.oid,
				state: {
					next_id: typeof parsed.next_id === "number" ? parsed.next_id : 1,
					ops: Array.isArray(parsed.ops) ? parsed.ops : [],
				},
			};
		} catch {
			// Corrupt blob — fall back to empty state and let the next
			// write overwrite it. Surfacing an error here would block
			// every read; we prefer self-healing.
			return { oid: match.oid, state: structuredClone(EMPTY_STATE) };
		}
	}

	/**
	 * Allocate the next id, bump the counter, and persist atomically.
	 * Returns the formatted id (e.g. `T-007`) for the caller.
	 *
	 * On CAS conflict, fetches the ref from origin (if any) and
	 * retries once. Further conflicts throw a clear error.
	 */
	async allocateNextId(config: OrdnaConfig): Promise<string> {
		return this.#withRetry(async () => {
			const { oid, state } = await this.#readUncachedAndCache();
			const allocated = formatId(config, state.next_id);
			const nextState: SyncState = {
				next_id: state.next_id + 1,
				ops: state.ops,
			};
			await this.#writeCAS(oid, nextState);
			return allocated;
		});
	}

	/** Append a single op to the audit log and persist atomically. */
	async appendOp(op: Op): Promise<void> {
		await this.#withRetry(async () => {
			const { oid, state } = await this.#readUncachedAndCache();
			const nextState: SyncState = {
				next_id: state.next_id,
				ops: [...state.ops, op],
			};
			await this.#writeCAS(oid, nextState);
		});
	}

	/**
	 * Pull origin's state ref and merge it into the local one (max
	 * next_id, unioned ops). This is what makes id allocation
	 * collision-safe across clones: call it before allocating so
	 * another machine's allocations are reflected locally.
	 *
	 * Best-effort by default — no remote, network down, or remote ref
	 * absent all degrade to "allocate from local state". Throttled to
	 * one fetch per 5s unless `force`.
	 *
	 * With `requireReachable` (the id-allocation path in hybrid and
	 * namespace mode), an unreachable remote becomes a thrown error
	 * instead: allocating from possibly-stale local state is how two
	 * machines mint the same task id, so creation refuses until the
	 * shared counter can be consulted. A reachable remote that simply
	 * has no state ref yet is fine (first push wins).
	 */
	async fetchAndMergeRemote(
		opts: { force?: boolean; requireReachable?: boolean } = {},
	): Promise<void> {
		const now = Date.now();
		if (!opts.force && !opts.requireReachable && now - this.#lastRemoteSyncMs < REMOTE_SYNC_TTL_MS)
			return;
		this.#lastRemoteSyncMs = now;
		if (!(await this.git.hasRemote())) return;

		try {
			await this.git.fetchRefspec(`+${this.refname}:${this.#originTrackRef}`);
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			if (raw.toLowerCase().includes("couldn't find remote ref")) {
				// Remote exists but has no state ref yet — first push wins.
				this.#originOid = "";
				return;
			}
			if (opts.requireReachable) {
				const firstLine = raw.split("\n").find((l) => l.trim().length > 0) ?? raw;
				throw new Error(
					`ordna: origin is unreachable — task ids are allocated from the shared state ref, so creating tasks needs a connection. Check your network and retry, or remove the remote (\`git remote remove origin\`) to work fully locally. (${firstLine.trim()})`,
				);
			}
			return; // network failure: proceed on local state
		}

		const refs = await this.git.forEachRef(this.#originTrackRef);
		const entry = refs.find((r) => r.refname === this.#originTrackRef);
		if (!entry) {
			this.#originOid = "";
			return;
		}
		this.#originOid = entry.oid;

		let remote: SyncState;
		try {
			const parsed = JSON.parse(await this.git.catBlob(entry.oid)) as SyncState;
			remote = {
				next_id: typeof parsed.next_id === "number" ? parsed.next_id : 1,
				ops: Array.isArray(parsed.ops) ? parsed.ops : [],
			};
		} catch {
			return; // unreadable remote blob — ignore
		}

		// Merge into local with a small CAS-retry loop (another local
		// writer may be mutating concurrently).
		for (let attempt = 0; attempt < 3; attempt++) {
			const { oid, state } = await this.#readUncachedAndCache();
			const merged = mergeSyncStates(state, remote);
			if (statesEqual(merged, state)) return;
			try {
				await this.#writeCAS(oid, merged);
				return;
			} catch (err) {
				if (!isCASConflict(err)) throw err;
				this.invalidate();
			}
		}
	}

	/**
	 * Push the local state ref to origin with `--force-with-lease`
	 * against the last known origin oid. On rejection (another machine
	 * pushed first), fetch + merge their state and retry — so diverged
	 * allocators converge instead of the old force-push silently
	 * clobbering whoever pushed last.
	 */
	async pushToOrigin(): Promise<void> {
		if (!(await this.git.hasRemote())) return;

		for (let attempt = 0; attempt < 3; attempt++) {
			if (this.#originOid === null) {
				// Never seen origin's state — learn it (and merge) first.
				await this.fetchAndMergeRemote({ force: true });
				if (this.#originOid === null) return; // network down; try next time
			}
			const { oid } = await this.#readUncachedAndCache();
			if (oid === null || oid === this.#originOid) return; // nothing to push

			try {
				await this.git.pushRefWithLease(this.refname, oid, this.#originOid);
				this.#originOid = oid;
				// Keep the tracking ref in step (best-effort).
				try {
					await this.git.updateRef(this.#originTrackRef, oid);
				} catch {
					// cosmetic only
				}
				return;
			} catch (err) {
				if (!isLeaseRejection(err)) throw err; // network/auth → caller logs
				// Remote moved underneath us: merge theirs in and retry.
				await this.fetchAndMergeRemote({ force: true });
			}
		}
		console.error(
			`[ordna] state push kept colliding for ${this.refname}; will retry on the next mutation.`,
		);
	}

	async #readUncachedAndCache(): Promise<{ oid: string | null; state: SyncState }> {
		const fresh = await this.#readUncached();
		this.#cached = fresh;
		return fresh;
	}

	async #writeCAS(expectedOid: string | null, nextState: SyncState): Promise<void> {
		const blob = `${JSON.stringify(nextState, null, 2)}\n`;
		const newOid = await this.git.hashObject(blob);
		// CAS: `""` if the ref must not exist; otherwise the captured oid.
		const expectedOld = expectedOid ?? EMPTY_OID;
		await this.git.updateRef(this.refname, newOid, expectedOld);
		// Successful write: update the cache to the new state.
		this.#cached = { oid: newOid, state: nextState };
	}

	/**
	 * Run an operation that does read-then-CAS-write. On CAS conflict,
	 * fetch the ref (best-effort if a remote exists) and retry once.
	 */
	async #withRetry<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (err) {
			if (!isCASConflict(err)) throw err;

			// Merge origin's state in (best-effort), then retry. Merge —
			// never a force fetch: overwriting the local ref with a stale
			// remote blob would roll the allocator backwards and lose
			// locally-recorded ops. The retry re-reads local state either
			// way, so concurrent in-process writers are handled too.
			await this.fetchAndMergeRemote({ force: true });
			this.invalidate();
			try {
				return await operation();
			} catch (retryErr) {
				if (isCASConflict(retryErr)) {
					throw new Error(
						`ordna: sync ref ${this.refname} diverged. Run \`git fetch origin '+${this.refname}:${this.refname}'\` to reconcile, then retry.`,
					);
				}
				throw retryErr;
			}
		}
	}
}

/**
 * Heuristic: a CAS conflict surfaces as a `git update-ref` failure
 * whose stderr mentions either a missing-ref / wrong-old / non-fast-
 * forward condition. We pattern-match on the thrown message rather
 * than introducing a typed error from `GitRunner` — keeps the runner
 * generic.
 */
/** Push rejected by the remote (lease failed / non-fast-forward). */
function isLeaseRejection(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return (
		msg.includes("rejected") ||
		msg.includes("stale info") ||
		msg.includes("non-fast-forward") ||
		msg.includes("fetch first")
	);
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

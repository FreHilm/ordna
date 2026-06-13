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

const EMPTY_STATE: SyncState = { next_id: 1, ops: [] };

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

	constructor(
		private readonly git: GitRunner,
		readonly refname: string = DEFAULT_REF,
	) {}

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

			// Fetch from origin if it exists, then retry. If fetch fails
			// (no remote, network down), the retry still re-reads local
			// state via forEachRef so concurrent in-process writers are
			// handled too.
			if (await this.git.hasRemote()) {
				try {
					await this.git.fetchRef(this.refname);
				} catch {
					// Best-effort; fall through to retry against local state.
				}
			}
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

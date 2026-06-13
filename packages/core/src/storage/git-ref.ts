import { spawn } from "node:child_process";

/**
 * Thin async wrapper around the `git` binary. Used by hybrid mode
 * (this task) and namespace mode (T-032).
 *
 * **Why `spawn` and not `execFile`?** `execFile`'s promisified async
 * form silently ignores the `input` option (only `execFileSync` /
 * `spawnSync` honour it). `git hash-object --stdin` then hangs forever
 * waiting for input that never arrives. `spawn` with explicit
 * `proc.stdin.write` is the only async path that actually delivers.
 *
 * Every command runs in `cwd` and returns stdout (utf-8). Errors
 * surface git's stderr in the thrown message so workflow / object
 * errors propagate clearly.
 */
export class GitRunner {
	constructor(private readonly cwd: string) {}

	/** Run a git command. Optional stdin piped via `proc.stdin`. */
	run(args: string[], stdin?: string | Buffer): Promise<string> {
		return new Promise((resolve, reject) => {
			const proc = spawn("git", args, { cwd: this.cwd });
			let stdout = "";
			let stderr = "";
			proc.stdout.on("data", (chunk) => {
				stdout += chunk.toString("utf8");
			});
			proc.stderr.on("data", (chunk) => {
				stderr += chunk.toString("utf8");
			});
			proc.on("error", (err) => {
				const e = err as NodeJS.ErrnoException;
				if (e.code === "ENOENT") {
					reject(
						new Error(
							"ordna: `git` binary not found on PATH. Install git to use hybrid or namespace storage.",
						),
					);
					return;
				}
				reject(err);
			});
			proc.on("close", (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(
						new Error(
							`git ${args.join(" ")} failed (${code}): ${stderr.trim() || "(no stderr)"}`,
						),
					);
				}
			});
			if (stdin !== undefined) {
				proc.stdin.write(stdin);
			}
			proc.stdin.end();
		});
	}

	/** Verify the cwd is inside a git working tree (or a bare repo). */
	async ensureRepository(): Promise<void> {
		try {
			await this.run(["rev-parse", "--git-dir"]);
		} catch {
			throw new Error(
				`ordna: ${this.cwd} is not a git repository. Run \`git init\` first or switch back to \`storage: file\`.`,
			);
		}
	}

	/**
	 * Check whether the given remote is configured. Defaults to "origin".
	 * Used as the gate for auto-push: no remote → all pushes are no-ops.
	 */
	async hasRemote(name = "origin"): Promise<boolean> {
		try {
			const out = await this.run(["remote"]);
			return out
				.split("\n")
				.map((line) => line.trim())
				.includes(name);
		} catch {
			return false;
		}
	}

	/** Write a blob from a string. Returns the resulting object ID. */
	async hashObject(content: string): Promise<string> {
		const out = await this.run(["hash-object", "-w", "--stdin"], content);
		return out.trim();
	}

	/** Read a blob's contents as a utf-8 string. */
	async catBlob(oid: string): Promise<string> {
		return this.run(["cat-file", "blob", oid]);
	}

	/**
	 * List refs matching a pattern. Returns `{refname, oid}` per ref,
	 * sorted in git's natural order.
	 */
	async forEachRef(
		pattern: string,
	): Promise<Array<{ refname: string; oid: string }>> {
		const out = await this.run([
			"for-each-ref",
			"--format=%(objectname) %(refname)",
			pattern,
		]);
		const lines = out.split("\n").filter((l) => l.length > 0);
		const result: Array<{ refname: string; oid: string }> = [];
		for (const line of lines) {
			const space = line.indexOf(" ");
			if (space <= 0) continue;
			const oid = line.slice(0, space);
			const refname = line.slice(space + 1);
			if (oid && refname) result.push({ refname, oid });
		}
		return result;
	}

	/**
	 * Atomically point `refname` at `newOid`, optionally requiring the
	 * ref to currently be at `expectedOld` (compare-and-swap).
	 *
	 *  - `expectedOld === ""` → require the ref to not yet exist
	 *  - `expectedOld === <oid>` → require the ref to currently equal that oid
	 *  - `expectedOld === undefined` → unconditional update
	 */
	async updateRef(
		refname: string,
		newOid: string,
		expectedOld?: string,
	): Promise<void> {
		const args = ["update-ref", refname, newOid];
		if (expectedOld !== undefined) args.push(expectedOld);
		await this.run(args);
	}

	/** Delete a ref. Same CAS semantics as `updateRef`. */
	async deleteRef(refname: string, expectedOld?: string): Promise<void> {
		const args = ["update-ref", "-d", refname];
		if (expectedOld !== undefined) args.push(expectedOld);
		await this.run(args);
	}

	/** Fetch a single ref from a remote. Soft-fails if no remote / network down. */
	async fetchRef(refname: string, remote = "origin"): Promise<void> {
		await this.run(["fetch", remote, `+${refname}:${refname}`]);
	}

	/**
	 * Fetch a refspec (single ref or wildcard) from a remote. Used by
	 * namespace mode to pull `+refs/ordna/tasks/*:refs/ordna/tasks/*` —
	 * the same refspec format `pushRef` accepts.
	 */
	async fetchRefspec(refspec: string, remote = "origin"): Promise<void> {
		await this.run(["fetch", remote, refspec]);
	}

	/**
	 * Push a refspec to a remote. The refspec can be a single
	 * `<src>:<dst>` or a glob `+refs/foo/*:refs/foo/*`.
	 */
	async pushRef(refspec: string, remote = "origin"): Promise<void> {
		await this.run(["push", remote, refspec]);
	}

	/**
	 * Push a single ref with `--force-with-lease` semantics. CAS at the
	 * git protocol level: the remote accepts the push only if its
	 * current ref value equals `expectedOld`. Empty string asserts the
	 * ref must not exist on the remote yet (used for creates).
	 *
	 * On a collision the remote rejects the push; the failure surfaces
	 * as a thrown Error with the relevant git stderr in the message,
	 * which callers parse to drive reconciliation.
	 */
	async pushRefWithLease(
		refname: string,
		newOid: string,
		expectedOld: string,
		remote = "origin",
	): Promise<void> {
		// --force-with-lease=<ref>:<expected> + a plain (non-+) refspec.
		// The lease is the CAS predicate; the refspec is the actual push.
		await this.run([
			"push",
			`--force-with-lease=${refname}:${expectedOld}`,
			remote,
			`${refname}:${refname}`,
		]);
	}

	/** Read the configured user identity for audit-log attribution. */
	async userEmail(): Promise<string | null> {
		try {
			const out = await this.run(["config", "user.email"]);
			const trimmed = out.trim();
			return trimmed.length > 0 ? trimmed : null;
		} catch {
			return null;
		}
	}
}

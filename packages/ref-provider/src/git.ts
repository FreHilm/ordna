import { spawn } from "node:child_process";

/**
 * Thin async wrapper around the `git` binary. Every command runs in
 * `cwd` and returns stdout (utf-8). Errors surface git's stderr in the
 * thrown message so workflow / object errors propagate clearly.
 *
 * Why not use a library (simple-git / nodegit / dugite)?
 * - Zero deps: keeps the plugin tarball ~ a few kilobytes.
 * - We use a tiny slice of git: hash-object, cat-file, update-ref,
 *   for-each-ref. Direct exec is shorter than the library wrapper.
 * - The user already has git installed — they're storing things in a
 *   git repo.
 *
 * Why `spawn` and not `execFile`? `execFile`'s async form silently
 * ignores the `input` option (only the *sync* variants honour it).
 * `git hash-object --stdin` needs real stdin; we pipe it explicitly.
 */
export class GitRunner {
	constructor(private readonly cwd: string) {}

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
							"ordna-ref: `git` binary not found on PATH. Install git to use the ref provider.",
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

	/** Verify we're in a git working tree (or a bare repo). */
	async ensureRepository(): Promise<void> {
		try {
			await this.run(["rev-parse", "--git-dir"]);
		} catch {
			throw new Error(
				`ordna-ref: ${this.cwd} is not a git repository. Run \`git init\` first or point ordna at a git-tracked directory.`,
			);
		}
	}

	/**
	 * Write a blob from a string. Returns the resulting object ID.
	 * Uses stdin to avoid temp files and quoting issues.
	 */
	async hashObject(content: string): Promise<string> {
		const out = await this.run(
			["hash-object", "-w", "--stdin"],
			content,
		);
		return out.trim();
	}

	/** Read a blob's contents as a utf-8 string. */
	async catBlob(oid: string): Promise<string> {
		return this.run(["cat-file", "blob", oid]);
	}

	/**
	 * Atomically point `refname` at `newOid`, optionally requiring the
	 * ref to currently be at `expectedOldOid` (compare-and-swap).
	 *
	 *  - Pass `expectedOldOid: ""` to require the ref to not yet exist
	 *    (creates a brand-new ref).
	 *  - Pass a real OID for updates: if the ref has moved, git refuses
	 *    with a non-zero exit; we surface the message verbatim.
	 *  - Pass `undefined` for unconditional update (no concurrency check).
	 */
	async updateRef(
		refname: string,
		newOid: string,
		expectedOldOid?: string,
	): Promise<void> {
		const args = ["update-ref", refname, newOid];
		if (expectedOldOid !== undefined) args.push(expectedOldOid);
		await this.run(args);
	}

	/** Delete a ref atomically; refuses if the ref has moved. */
	async deleteRef(refname: string, expectedOldOid?: string): Promise<void> {
		const args = ["update-ref", "-d", refname];
		if (expectedOldOid !== undefined) args.push(expectedOldOid);
		await this.run(args);
	}

	/**
	 * List refs matching a pattern. Returns an array of `{ name, oid }`.
	 * Format is `oid<TAB>refname<NL>` — same as `git for-each-ref` with
	 * no format string.
	 */
	async forEachRef(
		pattern: string,
	): Promise<{ refname: string; oid: string }[]> {
		const out = await this.run([
			"for-each-ref",
			"--format=%(objectname) %(refname)",
			pattern,
		]);
		const lines = out.split("\n").filter((l) => l.length > 0);
		const result: { refname: string; oid: string }[] = [];
		for (const line of lines) {
			const space = line.indexOf(" ");
			if (space <= 0) continue;
			const oid = line.slice(0, space);
			const refname = line.slice(space + 1);
			if (oid && refname) result.push({ refname, oid });
		}
		return result;
	}
}

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OrdnaConfig, configSchema } from "../config.js";
import { GitRunner } from "../storage/git-ref.js";
import { type Op, SyncRef } from "../storage/sync-ref.js";

const baseConfig: OrdnaConfig = configSchema.parse({});

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
});

async function makeGitRepo(): Promise<GitRunner> {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-sync-ref-"));
	tmpDirs.push(cwd);
	const git = new GitRunner(cwd);
	await git.run(["init", "--initial-branch=main", "--quiet"]);
	await git.run(["config", "user.email", "test@example.com"]);
	await git.run(["config", "user.name", "Ordna Test"]);
	return git;
}

function op(o: Op["op"], id: string, ts = "2026-06-09T10:00:00.000Z"): Op {
	return { ts, actor: "test@example.com", op: o, id };
}

describe("SyncRef.allocateNextId", () => {
	it("returns the first id and bumps to 2 on an empty (missing) ref", async () => {
		const git = await makeGitRepo();
		const sync = new SyncRef(git);

		const id1 = await sync.allocateNextId(baseConfig);
		expect(id1).toBe("T-001");

		// State after: next_id = 2
		const state = await sync.read();
		expect(state.next_id).toBe(2);
		expect(state.ops).toEqual([]);
	});

	it("continues from an existing high-water mark", async () => {
		const git = await makeGitRepo();
		const sync = new SyncRef(git);

		// Allocate four times → next_id should now be 5
		await sync.allocateNextId(baseConfig);
		await sync.allocateNextId(baseConfig);
		await sync.allocateNextId(baseConfig);
		await sync.allocateNextId(baseConfig);
		expect((await sync.read()).next_id).toBe(5);

		// Next allocation returns id-5 and bumps to 6
		const next = await sync.allocateNextId(baseConfig);
		expect(next).toBe("T-005");
		expect((await sync.read()).next_id).toBe(6);
	});

	it("respects the configured prefix and padding", async () => {
		const git = await makeGitRepo();
		const sync = new SyncRef(git);

		const cfg: OrdnaConfig = configSchema.parse({
			idPrefix: "BUG",
			zeroPaddedIds: 5,
		});
		expect(await sync.allocateNextId(cfg)).toBe("BUG-00001");
		expect(await sync.allocateNextId(cfg)).toBe("BUG-00002");
	});
});

describe("SyncRef.appendOp", () => {
	it("persists ops in insertion order", async () => {
		const git = await makeGitRepo();
		const sync = new SyncRef(git);

		await sync.appendOp(op("create", "T-001", "2026-06-09T10:00:00.000Z"));
		await sync.appendOp(op("update", "T-001", "2026-06-09T10:01:00.000Z"));
		await sync.appendOp(op("archive", "T-001", "2026-06-09T10:02:00.000Z"));

		const state = await sync.read();
		expect(state.ops.map((o) => o.op)).toEqual(["create", "update", "archive"]);
		expect(state.ops.map((o) => o.ts)).toEqual([
			"2026-06-09T10:00:00.000Z",
			"2026-06-09T10:01:00.000Z",
			"2026-06-09T10:02:00.000Z",
		]);
	});

	it("preserves next_id when only appending ops", async () => {
		const git = await makeGitRepo();
		const sync = new SyncRef(git);

		await sync.allocateNextId(baseConfig); // bumps next_id to 2
		await sync.appendOp(op("create", "T-001"));
		expect((await sync.read()).next_id).toBe(2);
	});
});

describe("SyncRef cache + CAS recovery", () => {
	it("read cache returns the same state until invalidated", async () => {
		const git = await makeGitRepo();
		const sync = new SyncRef(git);
		await sync.allocateNextId(baseConfig);

		const first = await sync.read();
		const second = await sync.read();
		// Same cached reference until invalidated.
		expect(second).toBe(first);

		sync.invalidate();
		const third = await sync.read();
		expect(third).not.toBe(first);
		expect(third).toEqual(first); // same content, different object
	});

	it("recovers from a CAS conflict by re-reading and retrying", async () => {
		// Two SyncRef instances pointing at the same ref simulate two
		// writers racing through the read-then-CAS-write window.
		const git = await makeGitRepo();
		const a = new SyncRef(git);
		const b = new SyncRef(git);

		// Both prime their caches with empty state.
		await a.read();
		await b.read();

		// A writes first (succeeds). B's cache is now stale.
		await a.allocateNextId(baseConfig);

		// B's write would CAS-conflict on the first attempt; the
		// recovery path re-reads and retries. The retried allocation
		// returns T-002 (because A already took T-001).
		const idFromB = await b.allocateNextId(baseConfig);
		expect(idFromB).toBe("T-002");

		const finalState = await a.read();
		a.invalidate();
		const reread = await a.read();
		expect(reread.next_id).toBe(3);
		// finalState is the post-cache view; reread sees what B wrote.
		expect(finalState.next_id).toBe(2);
	});
});

describe("HybridBackend storage layout (integration via the public store API)", () => {
	beforeEach(() => {
		// Tests in this suite write to a tmp git repo via the storage
		// layer. They don't share state with other suites.
	});

	it("creates a tasks/ directory, a .md file, and a refs/ordna/state ref", async () => {
		const git = await makeGitRepo();
		// The repo is at git.cwd internally; we can't access it from
		// outside the runner. Re-create here with explicit access:
		const cwd = mkdtempSync(join(tmpdir(), "ordna-hybrid-int-"));
		tmpDirs.push(cwd);
		const localGit = new GitRunner(cwd);
		await localGit.run(["init", "--initial-branch=main", "--quiet"]);
		await localGit.run(["config", "user.email", "test@example.com"]);
		await localGit.run(["config", "user.name", "Ordna Test"]);

		// Write a config that selects hybrid mode.
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(join(cwd, ".ordna"), { recursive: true });
		writeFileSync(join(cwd, ".ordna", "config.yaml"), "storage: hybrid\nschema: ordna\n", "utf8");

		const { createContext, createTask } = await import("../store.js");
		const ctx = createContext(cwd);

		const a = await createTask({ title: "First" }, ctx);
		const b = await createTask({ title: "Second" }, ctx);
		const c = await createTask({ title: "Third" }, ctx);
		expect([a.id, b.id, c.id]).toEqual(["T-001", "T-002", "T-003"]);

		// Each created a markdown file.
		expect(existsSync(join(cwd, "tasks", "T-001.md"))).toBe(true);
		expect(existsSync(join(cwd, "tasks", "T-002.md"))).toBe(true);
		expect(existsSync(join(cwd, "tasks", "T-003.md"))).toBe(true);

		// And the sync ref exists with next_id = 4 and three create ops.
		const refs = await localGit.forEachRef("refs/ordna/state");
		expect(refs).toHaveLength(1);
		const blob = await localGit.catBlob(refs[0]?.oid ?? "");
		const state = JSON.parse(blob) as { next_id: number; ops: Op[] };
		expect(state.next_id).toBe(4);
		expect(state.ops).toHaveLength(3);
		expect(state.ops.map((o) => o.op)).toEqual(["create", "create", "create"]);
		expect(state.ops.map((o) => o.id)).toEqual(["T-001", "T-002", "T-003"]);
	});
});

describe("Hybrid id allocation across clones (shared origin)", () => {
	async function setupOriginAndClones(): Promise<{
		originGit: GitRunner;
		cwdA: string;
		cwdB: string;
	}> {
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const root = mkdtempSync(join(tmpdir(), "ordna-hybrid-clones-"));
		tmpDirs.push(root);
		const originDir = join(root, "origin.git");
		const originGit = new GitRunner(root);
		await originGit.run(["init", "--bare", "--quiet", originDir]);

		const mkClone = async (name: string): Promise<string> => {
			const cwd = join(root, name);
			await originGit.run(["clone", "--quiet", originDir, cwd]);
			const git = new GitRunner(cwd);
			await git.run(["config", "user.email", `${name}@test.se`]);
			await git.run(["config", "user.name", name]);
			mkdirSync(join(cwd, ".ordna"), { recursive: true });
			writeFileSync(join(cwd, ".ordna", "config.yaml"), "storage: hybrid\nschema: ordna\n", "utf8");
			return cwd;
		};
		return {
			originGit: new GitRunner(originDir),
			cwdA: await mkClone("a"),
			cwdB: await mkClone("b"),
		};
	}

	async function readOriginState(originGit: GitRunner): Promise<{ next_id: number; ops: Op[] }> {
		const refs = await originGit.forEachRef("refs/ordna/state");
		const oid = refs.find((r) => r.refname === "refs/ordna/state")?.oid;
		expect(oid).toBeDefined();
		return JSON.parse(await originGit.catBlob(oid as string));
	}

	it("clone B allocates T-002 after clone A created T-001 (fetch-merge before allocate)", async () => {
		const { createContext, createTask } = await import("../store.js");
		const { originGit, cwdA, cwdB } = await setupOriginAndClones();

		const ctxA = createContext(cwdA);
		const a = await createTask({ title: "From A" }, ctxA);
		expect(a.id).toBe("T-001");
		await ctxA.backend.dispose(); // flush the lease push to origin

		const ctxB = createContext(cwdB);
		const b = await createTask({ title: "From B" }, ctxB);
		// The regression: B used to count from its own local state and
		// also hand out T-001.
		expect(b.id).toBe("T-002");
		await ctxB.backend.dispose();

		const state = await readOriginState(originGit);
		expect(state.next_id).toBe(3);
		expect(state.ops).toHaveLength(2);
	}, 20000);

	it("diverged state pushes converge via lease + merge instead of clobbering", async () => {
		const { createContext, createTask } = await import("../store.js");
		const { originGit, cwdA, cwdB } = await setupOriginAndClones();

		// A creates and pushes.
		const ctxA = createContext(cwdA);
		await createTask({ title: "A1" }, ctxA);
		await ctxA.backend.dispose();

		// B creates (fetch-merges → T-002) and pushes.
		const ctxB = createContext(cwdB);
		const b = await createTask({ title: "B1" }, ctxB);
		expect(b.id).toBe("T-002");
		await ctxB.backend.dispose();

		// A creates again immediately — within the 5s fetch throttle, so A
		// allocates from stale local state (this is the concurrent-create
		// window). Its push lease must be REJECTED (origin moved to B's
		// state), then merged and retried — not force-clobbered.
		const ctxA2 = createContext(cwdA);
		await createTask({ title: "A2" }, ctxA2);
		await ctxA2.backend.dispose();

		const state = await readOriginState(originGit);
		// Union of all three creates survives on origin; the old force-push
		// would have erased B's op and next_id.
		expect(state.ops).toHaveLength(3);
		expect(state.next_id).toBeGreaterThanOrEqual(3);
		const titles = state.ops.map((o) => o.op);
		expect(titles).toEqual(["create", "create", "create"]);
	}, 20000);
});

describe("Hybrid offline create is refused (strict allocation)", () => {
	it("create throws a clear error when origin is unreachable, with no file written", async () => {
		const { createContext, createTask } = await import("../store.js");
		const { cwdA } = await (async () => {
			const { mkdirSync, writeFileSync } = await import("node:fs");
			const root = mkdtempSync(join(tmpdir(), "ordna-hybrid-offline-"));
			tmpDirs.push(root);
			const cwd = join(root, "a");
			const git = new GitRunner(root);
			await git.run(["init", "--quiet", cwd]);
			const cloneGit = new GitRunner(cwd);
			await cloneGit.run(["config", "user.email", "a@test.se"]);
			await cloneGit.run(["config", "user.name", "a"]);
			await cloneGit.run(["remote", "add", "origin", "/nonexistent/ordna-offline.git"]);
			mkdirSync(join(cwd, ".ordna"), { recursive: true });
			writeFileSync(join(cwd, ".ordna", "config.yaml"), "storage: hybrid\nschema: ordna\n", "utf8");
			return { cwdA: cwd };
		})();

		const ctx = createContext(cwdA);
		await expect(createTask({ title: "Offline" }, ctx)).rejects.toThrow(/origin is unreachable/);
		expect(existsSync(join(cwdA, "tasks", "T-001.md"))).toBe(false);
		await ctx.backend.dispose();
	}, 15000);
});

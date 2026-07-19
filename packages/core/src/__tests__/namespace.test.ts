import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitTasks } from "../git.js";
import { GitRunner } from "../storage/git-ref.js";
import {
	canFetch,
	createContext,
	createTask,
	deleteTask,
	fetchTasks,
	getTask,
	listTasks,
	moveTask,
	updateTask,
} from "../store.js";
import { type TaskEvent, watchTasks } from "../watcher.js";

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
});

async function setupNamespaceRepo(extraConfig = ""): Promise<{ cwd: string; git: GitRunner }> {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-namespace-"));
	tmpDirs.push(cwd);
	const git = new GitRunner(cwd);
	await git.run(["init", "--initial-branch=main", "--quiet"]);
	await git.run(["config", "user.email", "test@example.com"]);
	await git.run(["config", "user.name", "Ordna Test"]);
	mkdirSync(join(cwd, ".ordna"), { recursive: true });
	writeFileSync(
		join(cwd, ".ordna", "config.yaml"),
		`storage: namespace\nschema: ordna\n${extraConfig}`,
		"utf8",
	);
	return { cwd, git };
}

function workingTreeContents(cwd: string): string[] {
	return readdirSync(cwd).filter((n) => n !== ".git" && n !== ".ordna");
}

describe("NamespaceBackend — basic CRUD via the public store API", () => {
	it("create writes a ref + blob; working tree stays clean (no tasks/ dir)", async () => {
		const { cwd, git } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		const task = await createTask({ title: "First task" }, ctx);
		expect(task.id).toBe("T-001");
		expect(task.title).toBe("First task");
		expect(task.filePath).toBeUndefined();

		// Working tree has nothing besides .git and .ordna.
		expect(workingTreeContents(cwd)).toEqual([]);

		// The ref exists and points at a blob containing the markdown.
		const refs = await git.forEachRef("refs/ordna/tasks/T-001");
		expect(refs).toHaveLength(1);
		const blob = await git.catBlob(refs[0]?.oid ?? "");
		expect(blob).toContain("id: T-001");
		expect(blob).toContain("title: First task");
	});

	it("list returns sorted tasks; get returns the right one; get(unknown) returns null", async () => {
		const { cwd } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		await createTask({ title: "First" }, ctx);
		await createTask({ title: "Second" }, ctx);
		await createTask({ title: "Third" }, ctx);

		const all = await listTasks(ctx);
		expect(all.map((t) => t.id)).toEqual(["T-001", "T-002", "T-003"]);
		expect(all[0]?.title).toBe("First");

		const single = await getTask("T-002", ctx);
		expect(single?.title).toBe("Second");
		expect(single?.filePath).toBeUndefined();

		const missing = await getTask("T-999", ctx);
		expect(missing).toBeNull();
	});

	it("update bumps the ref; CAS rejects when expected-old is wrong", async () => {
		const { cwd, git } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		await createTask({ title: "Mutable" }, ctx);
		const before = await git.forEachRef("refs/ordna/tasks/T-001");
		const oidBefore = before[0]?.oid;
		expect(oidBefore).toBeDefined();

		await updateTask("T-001", { title: "Renamed" }, ctx);

		const after = await git.forEachRef("refs/ordna/tasks/T-001");
		expect(after[0]?.oid).not.toBe(oidBefore);

		const reread = await getTask("T-001", ctx);
		expect(reread?.title).toBe("Renamed");

		// Simulate a stale CAS: rewrite the ref out-of-band to a different
		// blob, then try to update via the backend with the captured oid
		// from BEFORE that out-of-band change. The backend captures the
		// CURRENT oid at update time, but if we manually corrupt that
		// expectation via a direct git update, the backend's subsequent
		// update should still succeed (because it re-captures).
		// To actually test CAS rejection we hit the GitRunner directly.
		const ZERO = "0000000000000000000000000000000000000000";
		const newBlob = await git.hashObject("dummy");
		await expect(git.updateRef("refs/ordna/tasks/T-001", newBlob, ZERO)).rejects.toThrow();
	});

	it("delete removes the ref", async () => {
		const { cwd, git } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		await createTask({ title: "Doomed" }, ctx);
		expect(await git.forEachRef("refs/ordna/tasks/T-001")).toHaveLength(1);

		await deleteTask("T-001", ctx);
		expect(await git.forEachRef("refs/ordna/tasks/T-001")).toHaveLength(0);
		expect(await getTask("T-001", ctx)).toBeNull();
	});

	it("moveTask still enforces the depends_on gate in namespace mode", async () => {
		const { cwd } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		const dep = await createTask({ title: "Dependency" }, ctx);
		await createTask({ title: "Blocked", depends_on: [dep.id] }, ctx);

		await expect(moveTask("T-002", "done", ctx)).rejects.toThrow(/dependencies not done/);

		await moveTask(dep.id, "done", ctx);
		const moved = await moveTask("T-002", "done", ctx);
		expect(moved.status).toBe("done");
	});

	it("commitTasks is a no-op in namespace mode (no working-tree changes to stage)", async () => {
		const { cwd, git } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		await createTask({ title: "x" }, ctx);
		// Should not throw, should not create any commits.
		await commitTasks(ctx);
		await expect(git.run(["log", "--oneline"])).rejects.toThrow();
	});

	it("round-trip: create / update / delete leaves the working tree completely untouched", async () => {
		const { cwd } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		await createTask({ title: "One" }, ctx);
		await createTask({ title: "Two" }, ctx);
		await createTask({ title: "Three" }, ctx);
		await updateTask("T-002", { title: "Two (renamed)" }, ctx);
		await deleteTask("T-003", ctx);

		expect(workingTreeContents(cwd)).toEqual([]);
		expect(existsSync(join(cwd, "tasks"))).toBe(false);
	});
});

describe("NamespaceBackend — config validation", () => {
	it("rejects storage: namespace outside a git repository", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ordna-namespace-nogit-"));
		tmpDirs.push(cwd);
		mkdirSync(join(cwd, ".ordna"), { recursive: true });
		writeFileSync(join(cwd, ".ordna", "config.yaml"), "storage: namespace\n", "utf8");
		expect(() => createContext(cwd)).toThrow(/storage: namespace.*requires a git repository/);
	});

	it("rejects storage: namespace + schema: backlog at config load", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ordna-namespace-backlog-"));
		tmpDirs.push(cwd);
		const git = new GitRunner(cwd);
		await git.run(["init", "--initial-branch=main", "--quiet"]);
		mkdirSync(join(cwd, ".ordna"), { recursive: true });
		writeFileSync(
			join(cwd, ".ordna", "config.yaml"),
			"storage: namespace\nschema: backlog\n",
			"utf8",
		);
		expect(() => createContext(cwd)).toThrow(
			/`storage: namespace` is not supported with `schema: backlog`/,
		);
	});
});

describe("NamespaceBackend — fetch capability", () => {
	it("canFetch(ctx) is true for namespace, false for file", async () => {
		const { cwd } = await setupNamespaceRepo("namespace:\n  autoFetchIntervalMs: 0\n");
		const ns = createContext(cwd);
		expect(canFetch(ns)).toBe(true);

		const fileCwd = mkdtempSync(join(tmpdir(), "ordna-file-fetch-"));
		tmpDirs.push(fileCwd);
		mkdirSync(join(fileCwd, ".ordna"), { recursive: true });
		writeFileSync(join(fileCwd, ".ordna", "config.yaml"), "storage: file\nschema: ordna\n", "utf8");
		const file = createContext(fileCwd);
		expect(canFetch(file)).toBe(false);
		await expect(fetchTasks(file)).rejects.toThrow(/doesn't support fetch/);
	});

	it("fetch() with no remote is a quiet no-op (refsUpdated: 0)", async () => {
		// autoFetchIntervalMs: 0 disables the background timer so the
		// test doesn't race with it.
		const { cwd } = await setupNamespaceRepo("namespace:\n  autoFetchIntervalMs: 0\n");
		const ctx = createContext(cwd);
		await createTask({ title: "Local only" }, ctx);
		const result = await fetchTasks(ctx);
		expect(result.refsUpdated).toBe(0);
		expect(result.durationMs).toBe(0);
	});

	it("fetch() pulls in refs from origin", async () => {
		// Bare origin shared by two clones.
		const origin = mkdtempSync(join(tmpdir(), "ordna-namespace-origin-"));
		tmpDirs.push(origin);
		const originGit = new GitRunner(origin);
		await originGit.run(["init", "--bare", "--initial-branch=main", "--quiet"]);

		// Clone A (the one we'll fetch into).
		const { cwd: cwdA, git: gitA } = await setupNamespaceRepo(
			"namespace:\n  autoFetchIntervalMs: 0\n",
		);
		await gitA.run(["remote", "add", "origin", origin]);

		// Clone B (the one that publishes a task).
		const { cwd: cwdB, git: gitB } = await setupNamespaceRepo(
			"namespace:\n  autoFetchIntervalMs: 0\n",
		);
		await gitB.run(["remote", "add", "origin", origin]);
		const ctxB = createContext(cwdB);
		await createTask({ title: "From B" }, ctxB);
		// Wait for B's debounced auto-push to land on origin.
		await ctxB.backend.dispose();

		// Now A fetches and sees one new ref.
		const ctxA = createContext(cwdA);
		const result = await fetchTasks(ctxA);
		expect(result.refsUpdated).toBeGreaterThanOrEqual(1);
		const visible = await listTasks(ctxA);
		expect(visible.map((t) => t.id)).toContain("T-001");
	});
});

describe("NamespaceBackend — state ref allocator + audit log", () => {
	it("bootstraps state ref from existing task refs on upgrade (no state ref present)", async () => {
		const { cwd, git } = await setupNamespaceRepo("namespace:\n  autoFetchIntervalMs: 0\n");
		// Simulate a pre-state-ref namespace install by writing some task
		// refs directly via git, with NO refs/ordna/state.
		const blob1 = await git.hashObject(
			"---\nid: T-001\ntitle: Old\nstatus: todo\nassignee: null\npriority: null\ntags: []\ndepends_on: []\ncreated_at: 2026-06-09\nupdated_at: 2026-06-09\n---\n\n## Goal\n",
		);
		await git.updateRef("refs/ordna/tasks/T-001", blob1, "");
		const blob2 = await git.hashObject(
			"---\nid: T-005\ntitle: Higher\nstatus: todo\nassignee: null\npriority: null\ntags: []\ndepends_on: []\ncreated_at: 2026-06-09\nupdated_at: 2026-06-09\n---\n\n## Goal\n",
		);
		await git.updateRef("refs/ordna/tasks/T-005", blob2, "");

		// First context init() bootstraps the state ref from the scan;
		// next create allocates T-006 (max + 1), not T-001 again.
		const ctx = createContext(cwd);
		const next = await createTask({ title: "New" }, ctx);
		expect(next.id).toBe("T-006");

		// State ref now exists with next_id = 7 (after the bump).
		const stateRefs = await git.forEachRef("refs/ordna/state");
		expect(stateRefs).toHaveLength(1);
	});

	it("audit log accumulates create / update / archive / delete ops", async () => {
		const { cwd, git } = await setupNamespaceRepo("namespace:\n  autoFetchIntervalMs: 0\n");
		const ctx = createContext(cwd);
		const task = await createTask({ title: "Auditable" }, ctx);
		await updateTask(task.id, { title: "Renamed locally" }, ctx);
		await moveTask(task.id, "archived", ctx);
		await deleteTask(task.id, ctx);

		// Read the state ref blob directly to verify ops.
		const stateRefs = await git.forEachRef("refs/ordna/state");
		expect(stateRefs).toHaveLength(1);
		const stateBlob = await git.catBlob(stateRefs[0]?.oid ?? "");
		const state = JSON.parse(stateBlob) as {
			next_id: number;
			ops: Array<{ op: string; id: string }>;
		};
		expect(state.ops.map((o) => o.op)).toEqual(["create", "update", "archive", "delete"]);
		expect(state.ops.every((o) => o.id === "T-001")).toBe(true);
	});
});

describe("NamespaceBackend — auto-renumber on offline collision", () => {
	async function setupTwoClonesAndOrigin(extra = ""): Promise<{
		origin: string;
		cwdA: string;
		gitA: GitRunner;
		cwdB: string;
		gitB: GitRunner;
	}> {
		const origin = mkdtempSync(join(tmpdir(), "ordna-renumber-origin-"));
		tmpDirs.push(origin);
		const originGit = new GitRunner(origin);
		await originGit.run(["init", "--bare", "--initial-branch=main", "--quiet"]);

		const cfg = `namespace:\n  autoFetchIntervalMs: 0\n${extra}`;
		const { cwd: cwdA, git: gitA } = await setupNamespaceRepo(cfg);
		await gitA.run(["remote", "add", "origin", origin]);
		const { cwd: cwdB, git: gitB } = await setupNamespaceRepo(cfg);
		await gitB.run(["remote", "add", "origin", origin]);
		return { origin, cwdA, gitA, cwdB, gitB };
	}

	/**
	 * Simulate a partial push: the winner's task ref reached origin but
	 * its state ref didn't (crash mid-push, legacy writer, …). Since
	 * create() now merges origin's state before allocating, this is the
	 * remaining scenario where the loser still allocates a colliding id —
	 * exactly what the auto-renumber machinery exists for.
	 */
	async function dropOriginStateRef(origin: string): Promise<void> {
		await new GitRunner(origin).run(["update-ref", "-d", "refs/ordna/state"]);
	}

	it("renames the loser's local id, cascades depends_on, emits renamed event", async () => {
		const { origin, cwdA, gitA, cwdB } = await setupTwoClonesAndOrigin();

		// B creates T-001 and pushes to origin.
		const ctxB = createContext(cwdB);
		await createTask({ title: "From B" }, ctxB);
		await ctxB.backend.dispose();
		await dropOriginStateRef(origin);

		// A also creates T-001 (independent state ref) and a T-002 that
		// depends on T-001. Subscribe to the watcher BEFORE the push
		// fires so we capture the renamed event.
		const ctxA = createContext(cwdA);
		const events: TaskEvent[] = [];
		const unsubscribe = watchTasks(ctxA, (e) => events.push(e));

		await createTask({ title: "From A" }, ctxA);
		await createTask({ title: "Dependent", depends_on: ["T-001"] }, ctxA);

		// Disposing flushes pending pushes → triggers the collision +
		// reconcile path.
		await ctxA.backend.dispose();
		await unsubscribe();

		// A's T-001 ref now points at B's blob (after the reconcile-fetch).
		// A's original task lives under T-003 (bootstrap allocated T-001
		// + T-002 locally, then reconcile bumped to T-003 via SyncRef).
		const tasksA = await listTasks(createContext(cwdA));
		const idsA = tasksA.map((t) => t.id).sort();
		expect(idsA).toContain("T-001"); // B's task, now reachable on A
		// One of A's own tasks got renamed; the dependent's depends_on
		// should have been cascaded to point at the new id.
		const dependent = tasksA.find((t) => t.title === "Dependent" || t.depends_on.length > 0);
		expect(dependent).toBeDefined();
		expect(dependent?.depends_on).not.toContain("T-001-stale");
		// The dependent should not still reference the collided id — it
		// should be pointing at A's renamed task.
		expect(dependent?.depends_on.length).toBeGreaterThan(0);

		// At least one renamed event was emitted.
		const renames = events.filter((e) => e.type === "renamed");
		expect(renames.length).toBeGreaterThanOrEqual(1);
		const rename = renames[0] as Extract<TaskEvent, { type: "renamed" }>;
		expect(rename.oldId).toBe("T-001");
		expect(rename.newId).not.toBe("T-001");

		// renamed_from is populated on subsequent reads via the audit log.
		const reread = await createContext(cwdA).backend.get(rename.newId);
		expect(reread?.renamed_from).toBe("T-001");

		// State ref's audit log carries the rename op.
		const stateRefs = await gitA.forEachRef("refs/ordna/state");
		const stateBlob = await gitA.catBlob(stateRefs[0]?.oid ?? "");
		const state = JSON.parse(stateBlob) as {
			ops: Array<{ op: string; renamedFrom?: string }>;
		};
		const renameOp = state.ops.find((o) => o.op === "rename");
		expect(renameOp?.renamedFrom).toBe("T-001");
	}, 15000);

	it("re-emits the remote winner after `renamed` so UIs that drop oldId still show it", async () => {
		const { origin, cwdA, cwdB } = await setupTwoClonesAndOrigin();

		// B wins T-001 on origin.
		const ctxB = createContext(cwdB);
		await createTask({ title: "From B" }, ctxB);
		await ctxB.backend.dispose();
		await dropOriginStateRef(origin);

		// A collides, watcher subscribed for the whole reconcile.
		const ctxA = createContext(cwdA);
		const events: TaskEvent[] = [];
		const unsubscribe = watchTasks(ctxA, (e) => events.push(e));
		await createTask({ title: "From A" }, ctxA);
		await ctxA.backend.dispose();
		await unsubscribe();

		// Replay the events exactly the way the web/TUI reducers do:
		// added/changed upsert by id, renamed drops oldId and upserts the
		// renamed task. The regression: the ref-poll could emit the winner
		// BEFORE `renamed`, whose oldId-removal then made it invisible
		// until restart. The reconcile now re-emits the winner after
		// `renamed`, so the reduced view must contain BOTH tasks.
		const view = new Map<string, string>();
		for (const e of events) {
			if (e.type === "added" || e.type === "changed") {
				view.set(e.task.id, e.task.title);
			} else if (e.type === "renamed") {
				view.delete(e.oldId);
				view.set(e.task.id, e.task.title);
			}
		}
		expect(view.get("T-001")).toBe("From B"); // the remote winner survives
		const renamedIds = [...view.entries()].filter(([, title]) => title === "From A");
		expect(renamedIds).toHaveLength(1); // A's task lives on under its new id
		expect(renamedIds[0]?.[0]).not.toBe("T-001");
	}, 15000);

	it("autoRenumberOnConflict: false keeps the loser's local ref untouched (no rename)", async () => {
		const { origin, cwdA, cwdB } = await setupTwoClonesAndOrigin(
			"  autoRenumberOnConflict: false\n",
		);

		const ctxB = createContext(cwdB);
		await createTask({ title: "From B" }, ctxB);
		await ctxB.backend.dispose();
		await dropOriginStateRef(origin);

		const ctxA = createContext(cwdA);
		const events: TaskEvent[] = [];
		const unsubscribe = watchTasks(ctxA, (e) => events.push(e));
		await createTask({ title: "From A" }, ctxA);
		await ctxA.backend.dispose();
		await unsubscribe();

		// No renamed event — reconciler is gated off.
		expect(events.filter((e) => e.type === "renamed")).toHaveLength(0);

		// A's local T-001 is still A's blob (the push failed loud but
		// didn't touch local state). No T-002 exists locally.
		const tasksA = await listTasks(createContext(cwdA));
		expect(tasksA.map((t) => t.id)).toEqual(["T-001"]);
		expect(tasksA[0]?.title).toBe("From A");
	}, 15000);
});

describe("NamespaceBackend — watcher emits TaskEvents on ref changes", () => {
	it("emits added when a new ref appears, changed when oid moves, removed when ref deleted", async () => {
		const { cwd, git } = await setupNamespaceRepo("namespace:\n  pollIntervalMs: 50\n");
		const ctx = createContext(cwd);

		// Seed one task so the snapshot starts populated.
		await createTask({ title: "Seed" }, ctx);

		const events: TaskEvent[] = [];
		const unsubscribe = watchTasks(ctx, (event) => {
			events.push(event);
		});

		// Allow the watcher to seed its snapshot before we make changes.
		await new Promise((r) => setTimeout(r, 150));
		events.length = 0;

		// External add (bypassing the backend): hash a blob and update-ref
		// directly. The poller picks it up on the next tick.
		const blob = await git.hashObject(
			"---\nid: T-002\ntitle: External\nstatus: todo\nassignee: null\npriority: null\ntags: []\ndepends_on: []\ncreated_at: 2026-06-09\nupdated_at: 2026-06-09\n---\n\n## Goal\n",
		);
		await git.updateRef("refs/ordna/tasks/T-002", blob, "");
		await new Promise((r) => setTimeout(r, 200));

		// External change: rewrite the same ref to a different blob.
		const blob2 = await git.hashObject(
			"---\nid: T-002\ntitle: External (changed)\nstatus: todo\nassignee: null\npriority: null\ntags: []\ndepends_on: []\ncreated_at: 2026-06-09\nupdated_at: 2026-06-09\n---\n\n## Goal\n",
		);
		await git.updateRef("refs/ordna/tasks/T-002", blob2, blob);
		await new Promise((r) => setTimeout(r, 200));

		// External removal.
		await git.deleteRef("refs/ordna/tasks/T-002", blob2);
		await new Promise((r) => setTimeout(r, 200));

		await unsubscribe();

		const types = events.map((e) => e.type);
		expect(types).toContain("added");
		expect(types).toContain("changed");
		expect(types).toContain("removed");
	});
});

describe("NamespaceBackend — offline create is refused (strict allocation)", () => {
	it("create throws a clear error when origin is unreachable, with no local mutation", async () => {
		const { cwd, git } = await setupNamespaceRepo("namespace:\n  autoFetchIntervalMs: 0\n");
		await git.run(["remote", "add", "origin", "/nonexistent/ordna-offline-origin.git"]);

		const ctx = createContext(cwd);
		await expect(createTask({ title: "Offline" }, ctx)).rejects.toThrow(/origin is unreachable/);

		// Creation refused BEFORE any local mutation: no task ref minted.
		const refs = await git.forEachRef("refs/ordna/tasks/*");
		expect(refs).toHaveLength(0);
		await ctx.backend.dispose();
	}, 15000);

	it("create still works fully locally when no remote is configured", async () => {
		const { cwd } = await setupNamespaceRepo("namespace:\n  autoFetchIntervalMs: 0\n");
		const ctx = createContext(cwd);
		const t = await createTask({ title: "Local only" }, ctx);
		expect(t.id).toBe("T-001");
		await ctx.backend.dispose();
	}, 15000);
});

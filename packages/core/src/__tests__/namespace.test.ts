import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContext, createTask, deleteTask, getTask, listTasks, moveTask, updateTask } from "../store.js";
import { commitTasks } from "../git.js";
import { watchTasks, type TaskEvent } from "../watcher.js";
import { GitRunner } from "../storage/git-ref.js";

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
});

async function setupNamespaceRepo(
	extraConfig: string = "",
): Promise<{ cwd: string; git: GitRunner }> {
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
		await expect(
			git.updateRef("refs/ordna/tasks/T-001", newBlob, ZERO),
		).rejects.toThrow();
	});

	it("delete removes the ref", async () => {
		const { cwd, git } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		await createTask({ title: "Doomed" }, ctx);
		expect((await git.forEachRef("refs/ordna/tasks/T-001"))).toHaveLength(1);

		await deleteTask("T-001", ctx);
		expect((await git.forEachRef("refs/ordna/tasks/T-001"))).toHaveLength(0);
		expect(await getTask("T-001", ctx)).toBeNull();
	});

	it("moveTask still enforces the depends_on gate in namespace mode", async () => {
		const { cwd } = await setupNamespaceRepo();
		const ctx = createContext(cwd);

		const dep = await createTask({ title: "Dependency" }, ctx);
		await createTask({ title: "Blocked", depends_on: [dep.id] }, ctx);

		await expect(moveTask("T-002", "done", ctx)).rejects.toThrow(
			/dependencies not done/,
		);

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
		writeFileSync(
			join(cwd, ".ordna", "config.yaml"),
			"storage: namespace\n",
			"utf8",
		);
		expect(() => createContext(cwd)).toThrow(
			/storage: namespace.*requires a git repository/,
		);
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

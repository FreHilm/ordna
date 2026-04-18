import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createContext } from "../store.js";
import { createTask, moveTask, updateTask, listTasks, getTask } from "../store.js";
import { makeTempRepo } from "./helpers.js";

describe("store — ordna mode", () => {
	it("creates tasks with T-001 style IDs and lists them", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);

		const a = await createTask({ title: "First" }, ctx);
		const b = await createTask({ title: "Second" }, ctx);

		expect(a.id).toBe("T-001");
		expect(b.id).toBe("T-002");
		expect(a.status).toBe("todo");
		expect(a.filePath.endsWith("T-001.md")).toBe(true);

		const all = await listTasks(ctx);
		expect(all.map((t) => t.id)).toEqual(["T-001", "T-002"]);
	});

	it("move to done is blocked when depends_on has unfinished tasks", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);

		const dep = await createTask({ title: "Dep" }, ctx);
		const blocked = await createTask({ title: "Blocked", depends_on: [dep.id] }, ctx);

		await expect(moveTask(blocked.id, "done", ctx)).rejects.toThrow(/dependencies not done/);

		await moveTask(dep.id, "done", ctx);
		const moved = await moveTask(blocked.id, "done", ctx);
		expect(moved.status).toBe("done");
	});

	it("rejects unknown statuses", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "x" }, ctx);
		await expect(updateTask(t.id, { status: "nonsense" }, ctx)).rejects.toThrow(/not in configured/);
	});

	it("updates bump updated_at", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "x" }, ctx);
		const updated = await updateTask(t.id, { title: "y" }, ctx);
		const today = new Date().toISOString().slice(0, 10);
		expect(updated.updated_at).toBe(today);
		expect(updated.title).toBe("y");
	});
});

describe("store — backlog mode file naming", () => {
	it("writes task-N - slug.md files", async () => {
		const repo = makeTempRepo("backlog");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "Add Search Endpoint" }, ctx);
		expect(t.id).toBe("T-001");
		expect(t.filePath).toMatch(/task-1 - add-search-endpoint\.md$/);
		const content = readFileSync(t.filePath, "utf8");
		expect(content).toContain("labels:");
		expect(content).toContain("dependencies:");
	});
});

describe("store — defaults without config", () => {
	it("uses tasks/ and T-### with no .ordna/config.yaml", async () => {
		const { mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const cwd = mkdtempSync(join(tmpdir(), "ordna-defaults-"));
		const ctx = createContext(cwd);

		const t = await createTask({ title: "Default test" }, ctx);
		expect(t.id).toBe("T-001");
		expect(t.filePath.endsWith(join("tasks", "T-001.md"))).toBe(true);
		expect(t.status).toBe("todo");

		const fetched = await getTask("T-001", ctx);
		expect(fetched?.title).toBe("Default test");
	});
});

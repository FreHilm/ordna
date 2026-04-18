import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WireTask, WsEvent } from "../shared/types.js";
import { type RunWebHandle, runWeb } from "../server/start.js";

function setupRepo(): string {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-web-"));
	mkdirSync(join(cwd, ".ordna"));
	writeFileSync(join(cwd, ".ordna", "config.yaml"), "tasksDir: tasks\nschema: ordna\n", "utf8");
	mkdirSync(join(cwd, "tasks"));
	return cwd;
}

async function waitForWs(url: string): Promise<WebSocket> {
	const ws = new WebSocket(url);
	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = (e) => reject(e);
	});
	return ws;
}

describe("web server", () => {
	let handle: RunWebHandle;
	let cwd: string;
	let base: string;

	beforeAll(async () => {
		cwd = setupRepo();
		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		base = `http://127.0.0.1:${handle.port}`;
	});

	afterAll(async () => {
		await handle.close();
	});

	it("GET /api/config returns defaults", async () => {
		const res = await fetch(`${base}/api/config`);
		expect(res.status).toBe(200);
		const cfg = await res.json();
		expect(cfg.statuses).toEqual(["todo", "doing", "done"]);
		expect(cfg.tasksDir).toBe("tasks");
	});

	it("POST /api/tasks creates a task; GET /api/tasks lists it", async () => {
		const create = await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "First task" }),
		});
		expect(create.status).toBe(201);
		const created = (await create.json()) as WireTask;
		expect(created.id).toBe("T-001");
		expect(created.title).toBe("First task");

		const list = await fetch(`${base}/api/tasks`);
		const tasks = (await list.json()) as WireTask[];
		expect(tasks.map((t) => t.id)).toContain("T-001");
	});

	it("POST /api/tasks/:id/move respects depends_on gate", async () => {
		await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Dependent", depends_on: ["T-001"] }),
		});
		const blocked = await fetch(`${base}/api/tasks/T-002/move`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "done" }),
		});
		expect(blocked.status).toBe(400);
		const err = await blocked.json();
		expect(String(err.error)).toMatch(/dependencies not done/);

		const ok = await fetch(`${base}/api/tasks/T-001/move`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "done" }),
		});
		expect(ok.status).toBe(200);
	});

	it("WebSocket /ws receives task events", async () => {
		const ws = await waitForWs(`ws://127.0.0.1:${handle.port}/ws`);
		const events: WsEvent[] = [];
		ws.onmessage = (event) => {
			events.push(JSON.parse(event.data) as WsEvent);
		};

		await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Over the wire" }),
		});

		const deadline = Date.now() + 3000;
		while (Date.now() < deadline && events.length === 0) {
			await new Promise((r) => setTimeout(r, 50));
		}
		ws.close();

		expect(events.length).toBeGreaterThan(0);
		expect(["added", "changed"]).toContain(events[0]?.type);
	});
});

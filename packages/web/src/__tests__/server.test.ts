import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type RunWebHandle, runWeb } from "../server/start.js";
import type { WireTask, WsEvent } from "../shared/types.js";

function setupRepo(): string {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-web-"));
	mkdirSync(join(cwd, ".ordna"));
	writeFileSync(join(cwd, ".ordna", "config.yaml"), "tasksDir: tasks\nschema: ordna\n", "utf8");
	mkdirSync(join(cwd, "tasks"));
	return cwd;
}

function setupGitRepoNoConfig(): string {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-web-setup-"));
	spawnSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd });
	spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
	spawnSync("git", ["config", "user.name", "Ordna Test"], { cwd });
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

describe("web server — in-place setup transition", () => {
	const dirsToClean: string[] = [];
	let handle: RunWebHandle | null = null;

	afterEach(async () => {
		if (handle) {
			await handle.close();
			handle = null;
		}
		for (const dir of dirsToClean) {
			rmSync(dir, { recursive: true, force: true });
		}
		dirsToClean.length = 0;
	});

	it("starts in setup mode, transitions to ready in-place after POST /api/setup-mode", async () => {
		const cwd = setupGitRepoNoConfig();
		dirsToClean.push(cwd);

		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		const base = `http://127.0.0.1:${handle.port}`;

		// Setup mode: ctx is null, GET / returns the setup page.
		expect(handle.needsSetup).toBe(true);
		expect(handle.context).toBeNull();
		const setupRes = await fetch(`${base}/`);
		expect(setupRes.status).toBe(200);
		const setupHtml = await setupRes.text();
		expect(setupHtml).toContain('action="/api/setup-mode"');
		expect(setupHtml).toContain('value="file"');

		// API surface is gated until config is written.
		const gated = await fetch(`${base}/api/config`);
		expect(gated.status).toBe(200);
		const gatedBody = await gated.text();
		expect(gatedBody).toContain('action="/api/setup-mode"');

		// POST the choice — server writes config, builds ctx, returns a
		// "loading the board" page with a meta-refresh.
		const post = await fetch(`${base}/api/setup-mode`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "storage=file",
			redirect: "manual",
		});
		expect(post.status).toBe(200);
		const postBody = await post.text();
		expect(postBody).toContain('http-equiv="refresh"');
		expect(postBody).toContain("Storage mode set to <code>file</code>");

		// Config is now on disk.
		const cfgPath = join(cwd, ".ordna", "config.yaml");
		expect(existsSync(cfgPath)).toBe(true);
		expect(readFileSync(cfgPath, "utf8")).toContain("storage: file");

		// Handle reflects the transition; the API surface is live on the same port.
		expect(handle.needsSetup).toBe(false);
		expect(handle.context).not.toBeNull();
		const cfg = await (await fetch(`${base}/api/config`)).json();
		expect(cfg.statuses).toEqual(["todo", "doing", "done"]);

		// A re-POST after transition is rejected.
		const replay = await fetch(`${base}/api/setup-mode`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "storage=hybrid",
		});
		expect(replay.status).toBe(400);
	});

	it("POST /api/setup-mode rejects an invalid storage value", async () => {
		const cwd = setupGitRepoNoConfig();
		dirsToClean.push(cwd);

		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		const base = `http://127.0.0.1:${handle.port}`;

		const res = await fetch(`${base}/api/setup-mode`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "storage=garbage",
		});
		expect(res.status).toBe(400);
		expect(handle.needsSetup).toBe(true);
		expect(existsSync(join(cwd, ".ordna", "config.yaml"))).toBe(false);
	});
});

describe("web server — fetch capability", () => {
	const dirsToClean: string[] = [];
	let handle: RunWebHandle | null = null;

	afterEach(async () => {
		if (handle) {
			await handle.close();
			handle = null;
		}
		for (const dir of dirsToClean) {
			rmSync(dir, { recursive: true, force: true });
		}
		dirsToClean.length = 0;
	});

	it("file mode: /api/config reports capabilities.fetch=false; POST /api/fetch → 501", async () => {
		const cwd = setupRepo(); // file mode
		dirsToClean.push(cwd);
		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		const base = `http://127.0.0.1:${handle.port}`;

		const cfg = await (await fetch(`${base}/api/config`)).json();
		expect(cfg.capabilities).toEqual({ fetch: false, attach: true });

		const res = await fetch(`${base}/api/fetch`, { method: "POST" });
		expect(res.status).toBe(501);
		const body = await res.json();
		expect(String(body.error)).toMatch(/doesn't support fetch/);
	});

	it("namespace mode: /api/config reports capabilities.fetch=true; POST /api/fetch → 200", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ordna-web-ns-"));
		dirsToClean.push(cwd);
		spawnSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd });
		spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
		spawnSync("git", ["config", "user.name", "Ordna Test"], { cwd });
		mkdirSync(join(cwd, ".ordna"), { recursive: true });
		writeFileSync(
			join(cwd, ".ordna", "config.yaml"),
			"storage: namespace\nschema: ordna\nnamespace:\n  autoFetchIntervalMs: 0\n",
			"utf8",
		);

		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		const base = `http://127.0.0.1:${handle.port}`;

		const cfg = await (await fetch(`${base}/api/config`)).json();
		expect(cfg.capabilities).toEqual({ fetch: true, attach: true });

		// No remote configured → fetch is a quiet no-op (refsUpdated: 0).
		const res = await fetch(`${base}/api/fetch`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.refsUpdated).toBe(0);
		expect(typeof body.durationMs).toBe("number");
	});
});

describe("web server — attachments", () => {
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
		rmSync(cwd, { recursive: true, force: true });
	});

	async function createTask(title: string): Promise<WireTask> {
		const res = await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title }),
		});
		return (await res.json()) as WireTask;
	}

	function upload(id: string, name: string, type: string, bytes: Uint8Array) {
		const form = new FormData();
		form.append("file", new File([bytes], name, { type }));
		return fetch(`${base}/api/tasks/${id}/attachments`, {
			method: "POST",
			body: form,
		});
	}

	it("uploads, downloads, and removes an attachment round-trip", async () => {
		const task = await createTask("Attach me");
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]);

		// upload
		const up = await upload(task.id, "chart.png", "image/png", png);
		expect(up.status).toBe(201);
		const withAtt = (await up.json()) as WireTask;
		expect(withAtt.attachments).toHaveLength(1);
		const att = withAtt.attachments[0];
		expect(att?.name).toBe("chart.png");
		expect(att?.type).toBe("image/png");
		expect(att?.size).toBe(png.byteLength);

		// download — exact bytes + headers
		const dl = await fetch(`${base}/api/tasks/${task.id}/attachments/${att?.id}`);
		expect(dl.status).toBe(200);
		expect(dl.headers.get("content-type")).toBe("image/png");
		expect(dl.headers.get("content-disposition")).toContain("chart.png");
		const back = new Uint8Array(await dl.arrayBuffer());
		expect(Array.from(back)).toEqual(Array.from(png));

		// the file lives under tasks/attachments/<id>/
		expect(att?.src).toBe(`attachments/${task.id}/${att?.id}-chart.png`);
		expect(existsSync(join(cwd, "tasks", att?.src ?? ""))).toBe(true);

		// remove
		const del = await fetch(`${base}/api/tasks/${task.id}/attachments/${att?.id}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(200);
		const cleared = (await del.json()) as WireTask;
		expect(cleared.attachments).toEqual([]);
		expect(existsSync(join(cwd, "tasks", att?.src ?? ""))).toBe(false);
	});

	it("POST without a file field returns 400", async () => {
		const task = await createTask("No file");
		const res = await fetch(`${base}/api/tasks/${task.id}/attachments`, {
			method: "POST",
			body: new FormData(),
		});
		expect(res.status).toBe(400);
	});

	it("GET unknown attachment returns 404", async () => {
		const task = await createTask("Missing");
		const res = await fetch(`${base}/api/tasks/${task.id}/attachments/a99`);
		expect(res.status).toBe(404);
	});
});

describe("web server — attachment size cap", () => {
	let handle: RunWebHandle;
	let cwd: string;
	let base: string;

	beforeAll(async () => {
		cwd = mkdtempSync(join(tmpdir(), "ordna-web-cap-"));
		mkdirSync(join(cwd, ".ordna"));
		writeFileSync(
			join(cwd, ".ordna", "config.yaml"),
			"tasksDir: tasks\nschema: ordna\nattachments:\n  maxSizeMb: 1\n",
			"utf8",
		);
		mkdirSync(join(cwd, "tasks"));
		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		base = `http://127.0.0.1:${handle.port}`;
	});

	afterAll(async () => {
		await handle.close();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("rejects an upload above attachments.maxSizeMb with 413", async () => {
		const create = await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Too big" }),
		});
		const task = (await create.json()) as WireTask;

		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(1.5 * 1024 * 1024)], "big.bin", {
				type: "application/octet-stream",
			}),
		);
		const res = await fetch(`${base}/api/tasks/${task.id}/attachments`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(413);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("limit is 1 MB");

		// registry untouched
		const after = await fetch(`${base}/api/tasks/${task.id}`);
		const reloaded = (await after.json()) as WireTask;
		expect(reloaded.attachments).toEqual([]);
	});

	it("accepts an upload under the limit", async () => {
		const create = await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Small enough" }),
		});
		const task = (await create.json()) as WireTask;

		const form = new FormData();
		form.append("file", new File([new Uint8Array(1024)], "small.bin"));
		const res = await fetch(`${base}/api/tasks/${task.id}/attachments`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(201);
	});
});

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunWebHandle, runWeb } from "../server/start.js";

function setupRepo(): string {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-agent-"));
	mkdirSync(join(cwd, ".ordna"));
	writeFileSync(join(cwd, ".ordna", "config.yaml"), "tasksDir: tasks\nschema: ordna\n", "utf8");
	mkdirSync(join(cwd, "tasks"));
	return cwd;
}

describe("agent hook", () => {
	let hookUrl: string;
	let hookServer: ReturnType<typeof createServer>;
	let received: Array<{ url: string; body: unknown; headers: Record<string, string | undefined> }>;
	let handle: RunWebHandle | null = null;
	let cwd: string;
	let base: string;

	beforeAll(async () => {
		received = [];
		hookServer = createServer((req, res) => {
			let data = "";
			req.on("data", (chunk) => {
				data += chunk;
			});
			req.on("end", () => {
				let body: unknown = data;
				try {
					body = JSON.parse(data);
				} catch {
					// keep raw string
				}
				received.push({
					url: req.url ?? "",
					body,
					headers: {
						"content-type": req.headers["content-type"] as string | undefined,
						"x-agent-token": req.headers["x-agent-token"] as string | undefined,
					},
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ accepted: true }));
			});
		});
		await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", r));
		const addr = hookServer.address() as AddressInfo;
		hookUrl = `http://127.0.0.1:${addr.port}/agent`;
	});

	afterAll(async () => {
		await new Promise<void>((r) => hookServer.close(() => r()));
	});

	beforeEach(async () => {
		cwd = setupRepo();
		process.env.ORDNA_AGENT_HOOK_URL = hookUrl;
		process.env.ORDNA_AGENT_HOOK_LABEL = "Claude";
		process.env.ORDNA_AGENT_HOOK_HEADERS = JSON.stringify({
			"X-Agent-Token": "secret",
		});
		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		base = `http://127.0.0.1:${handle.port}`;
		received.length = 0;
	});

	afterEach(async () => {
		if (handle) {
			await handle.close();
			handle = null;
		}
		delete process.env.ORDNA_AGENT_HOOK_URL;
		delete process.env.ORDNA_AGENT_HOOK_LABEL;
		delete process.env.ORDNA_AGENT_HOOK_HEADERS;
	});

	it("config exposes agentHook info", async () => {
		const res = await fetch(`${base}/api/config`);
		expect(res.status).toBe(200);
		const cfg = (await res.json()) as {
			agentHook: { enabled: boolean; label: string } | null;
		};
		expect(cfg.agentHook).toEqual({ enabled: true, label: "Claude" });
	});

	it("POST /api/tasks/:id/agent forwards to the hook URL with headers", async () => {
		const created = await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Ship it" }),
		});
		const task = (await created.json()) as { id: string };

		const res = await fetch(`${base}/api/tasks/${task.id}/agent`, { method: "POST" });
		expect(res.status).toBe(200);

		expect(received.length).toBe(1);
		expect(received[0]?.url).toBe("/agent");
		expect(received[0]?.headers["x-agent-token"]).toBe("secret");
		const body = received[0]?.body as {
			action: string;
			task: { id: string; title: string };
			context: { tasksDir: string; cwd: string; schema: string };
		};
		expect(body.action).toBe("agent");
		expect(body.task.id).toBe(task.id);
		expect(body.task.title).toBe("Ship it");
		expect(body.context.tasksDir).toBe("tasks");
		expect(body.context.schema).toBe("ordna");
	});
});

describe("programmatic agentHook overrides env", () => {
	let hookServer: ReturnType<typeof createServer>;
	let hookUrl: string;
	let received: Array<{ headers: Record<string, string | undefined> }>;
	let handle: RunWebHandle;
	let base: string;

	beforeAll(async () => {
		received = [];
		hookServer = createServer((req, res) => {
			received.push({
				headers: { "x-agent-token": req.headers["x-agent-token"] as string | undefined },
			});
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end("{}");
		});
		await new Promise<void>((r) => hookServer.listen(0, "127.0.0.1", r));
		const addr = hookServer.address() as AddressInfo;
		hookUrl = `http://127.0.0.1:${addr.port}/programmatic`;

		// Env var is intentionally bogus — we should NOT use it.
		process.env.ORDNA_AGENT_HOOK_URL = "http://127.0.0.1:0/should-not-be-used";
		process.env.ORDNA_AGENT_HOOK_LABEL = "FromEnv";

		const cwd = setupRepo();
		handle = await runWeb({
			cwd,
			port: 0,
			host: "127.0.0.1",
			openBrowser: false,
			agentHook: {
				url: hookUrl,
				label: "FromCode",
				headers: { "X-Agent-Token": "from-code" },
			},
		});
		base = `http://127.0.0.1:${handle.port}`;
	});

	afterAll(async () => {
		await handle.close();
		await new Promise<void>((r) => hookServer.close(() => r()));
		delete process.env.ORDNA_AGENT_HOOK_URL;
		delete process.env.ORDNA_AGENT_HOOK_LABEL;
	});

	it("uses the programmatic config, not the env vars", async () => {
		const cfgRes = await fetch(`${base}/api/config`);
		const cfg = (await cfgRes.json()) as {
			agentHook: { enabled: boolean; label: string };
		};
		expect(cfg.agentHook.label).toBe("FromCode");

		await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "X" }),
		});
		const res = await fetch(`${base}/api/tasks/T-001/agent`, { method: "POST" });
		expect(res.status).toBe(200);
		expect(received[0]?.headers["x-agent-token"]).toBe("from-code");
	});
});

describe("agent hook disabled", () => {
	let handle: RunWebHandle;
	let base: string;

	beforeAll(async () => {
		delete process.env.ORDNA_AGENT_HOOK_URL;
		const cwd = setupRepo();
		handle = await runWeb({ cwd, port: 0, host: "127.0.0.1", openBrowser: false });
		base = `http://127.0.0.1:${handle.port}`;
	});

	afterAll(async () => {
		await handle.close();
	});

	it("config returns agentHook: null when env is unset", async () => {
		const res = await fetch(`${base}/api/config`);
		const cfg = (await res.json()) as {
			agentHook: unknown;
		};
		expect(cfg.agentHook).toBeNull();
	});

	it("/api/tasks/:id/agent returns 501 when hook is unconfigured", async () => {
		await fetch(`${base}/api/tasks`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Unused" }),
		});
		const res = await fetch(`${base}/api/tasks/T-001/agent`, { method: "POST" });
		expect(res.status).toBe(501);
	});
});

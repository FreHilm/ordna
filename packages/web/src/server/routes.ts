import {
	type StoreContext,
	addAttachment,
	canAttach,
	canFetch,
	createTask,
	deleteTask,
	fetchTasks,
	getTask,
	listTasks,
	moveTask,
	readAttachment,
	removeAttachment,
	updateTask,
} from "@frehilm/ordna-core";
import { Hono } from "hono";
import { toWireTask } from "../shared/types.js";
import { type AgentHookConfig, postAgent } from "./agent.js";

/**
 * Mutable handle the API routes read from at request time. Letting routes
 * resolve `ctx` lazily is what makes the in-place setup → ready transition
 * possible: the same Hono app is mounted once, and the API surface flips on
 * as soon as `state.ctx` becomes non-null.
 */
export interface ApiState {
	ctx: StoreContext | null;
	agentHook: AgentHookConfig | null;
}

export function buildApiRoutes(state: ApiState): Hono {
	const api = new Hono();

	// Gate every /api/* request on a configured context. The outer gate in
	// start.ts already short-circuits non-setup paths when ctx is null, so
	// this is belt-and-braces — but it also keeps the route handlers free
	// of repeated null checks.
	api.use("*", async (c, next) => {
		if (!state.ctx) return c.json({ error: "not configured" }, 503);
		return next();
	});

	api.get("/config", (c) => {
		const ctx = state.ctx as StoreContext;
		return c.json({
			...ctx.config,
			agentHook: state.agentHook ? { enabled: true, label: state.agentHook.label } : null,
			capabilities: { fetch: canFetch(ctx), attach: canAttach(ctx) },
		});
	});

	api.post("/fetch", async (c) => {
		const ctx = state.ctx as StoreContext;
		if (!canFetch(ctx)) {
			return c.json({ error: `storage: ${ctx.backend.kind} doesn't support fetch` }, 501);
		}
		try {
			const result = await fetchTasks(ctx);
			return c.json({ ok: true, ...result });
		} catch (err) {
			return c.json({ error: (err as Error).message }, 500);
		}
	});

	api.get("/tasks", async (c) => {
		const tasks = await listTasks(state.ctx as StoreContext);
		return c.json(tasks.map(toWireTask));
	});

	api.get("/tasks/:id", async (c) => {
		const task = await getTask(c.req.param("id"), state.ctx as StoreContext);
		if (!task) return c.json({ error: "not found" }, 404);
		return c.json(toWireTask(task));
	});

	api.post("/tasks", async (c) => {
		const body = (await c.req.json()) as {
			title?: string;
			assignee?: string | null;
			priority?: "high" | "medium" | "low" | null;
			tags?: string[];
			depends_on?: string[];
			status?: string;
		};
		if (!body.title || body.title.trim().length === 0) {
			return c.json({ error: "title is required" }, 400);
		}
		try {
			const task = await createTask(body as { title: string }, state.ctx as StoreContext);
			return c.json(toWireTask(task), 201);
		} catch (err) {
			// Offline in hybrid/namespace mode surfaces here ("origin is
			// unreachable") — a retryable condition, not a client mistake.
			const msg = (err as Error).message;
			return c.json({ error: msg }, msg.includes("unreachable") ? 503 : 400);
		}
	});

	api.patch("/tasks/:id", async (c) => {
		const id = c.req.param("id");
		const patch = await c.req.json();
		try {
			const task = await updateTask(id, patch, state.ctx as StoreContext);
			return c.json(toWireTask(task));
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	api.post("/tasks/:id/move", async (c) => {
		const id = c.req.param("id");
		const { status } = (await c.req.json()) as { status: string };
		try {
			const task = await moveTask(id, status, state.ctx as StoreContext);
			return c.json(toWireTask(task));
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	api.post("/tasks/:id/agent", async (c) => {
		if (!state.agentHook) {
			return c.json({ error: "agent hook not configured" }, 501);
		}
		const ctx = state.ctx as StoreContext;
		const task = await getTask(c.req.param("id"), ctx);
		if (!task) return c.json({ error: "not found" }, 404);
		try {
			const result = await postAgent(state.agentHook, task, {
				tasksDir: ctx.config.tasksDir,
				cwd: ctx.cwd,
				schema: ctx.config.schema,
			});
			if (!result.ok) {
				return c.json({ error: result.body || `hook returned ${result.status}` }, 502);
			}
			return c.json({ ok: true });
		} catch (err) {
			return c.json({ error: (err as Error).message }, 502);
		}
	});

	// ---- attachments ----

	api.post("/tasks/:id/attachments", async (c) => {
		const ctx = state.ctx as StoreContext;
		if (!canAttach(ctx)) {
			return c.json({ error: `storage: ${ctx.backend.kind} doesn't support attachments` }, 501);
		}
		const id = c.req.param("id");
		const body = await c.req.parseBody();
		const file = body.file;
		if (!(file instanceof File)) {
			return c.json({ error: "expected a `file` field (multipart/form-data)" }, 400);
		}
		// Size gate before buffering. Core enforces the same limit as a
		// backstop, but rejecting here avoids holding the bytes in memory.
		const maxMb = ctx.config.attachments.maxSizeMb;
		if (maxMb > 0 && file.size > maxMb * 1024 * 1024) {
			const actualMb = (file.size / (1024 * 1024)).toFixed(1);
			return c.json(
				{
					error: `"${file.name}" is ${actualMb} MB; the limit is ${maxMb} MB (attachments.maxSizeMb in .ordna/config.yaml).`,
				},
				413,
			);
		}
		try {
			const bytes = Buffer.from(await file.arrayBuffer());
			await addAttachment(id, { name: file.name, type: file.type || null, bytes }, ctx);
			// Return the updated task so the client can refresh its
			// attachments list without a round-trip.
			const task = await getTask(id, ctx);
			if (!task) return c.json({ error: "not found" }, 404);
			return c.json(toWireTask(task), 201);
		} catch (err) {
			return c.json({ error: (err as Error).message }, 400);
		}
	});

	api.get("/tasks/:id/attachments/:attId", async (c) => {
		const ctx = state.ctx as StoreContext;
		if (!canAttach(ctx)) return c.json({ error: "not supported" }, 501);
		try {
			const { meta, bytes } = await readAttachment(c.req.param("id"), c.req.param("attId"), ctx);
			// `inline` so images preview in-browser; filename drives the
			// download name when the user saves it. Quotes escaped.
			const safeName = meta.name.replace(/"/g, "");
			// Copy into a fresh ArrayBuffer-backed view — Hono's body type
			// rejects Node's Buffer (ArrayBufferLike).
			const u8 = new Uint8Array(bytes);
			return c.body(u8, 200, {
				"Content-Type": meta.type ?? "application/octet-stream",
				"Content-Disposition": `inline; filename="${safeName}"`,
				"Content-Length": String(u8.byteLength),
			});
		} catch (err) {
			return c.json({ error: (err as Error).message }, 404);
		}
	});

	api.delete("/tasks/:id/attachments/:attId", async (c) => {
		const ctx = state.ctx as StoreContext;
		if (!canAttach(ctx)) return c.json({ error: "not supported" }, 501);
		const id = c.req.param("id");
		try {
			await removeAttachment(id, c.req.param("attId"), ctx);
			const task = await getTask(id, ctx);
			if (!task) return c.json({ error: "not found" }, 404);
			return c.json(toWireTask(task));
		} catch (err) {
			return c.json({ error: (err as Error).message }, 404);
		}
	});

	api.delete("/tasks/:id", async (c) => {
		try {
			await deleteTask(c.req.param("id"), state.ctx as StoreContext);
			return c.body(null, 204);
		} catch (error) {
			return c.json({ error: (error as Error).message }, 404);
		}
	});

	return api;
}

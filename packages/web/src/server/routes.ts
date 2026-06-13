import {
	canFetch,
	createTask,
	deleteTask,
	fetchTasks,
	getTask,
	listTasks,
	moveTask,
	type StoreContext,
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
			agentHook: state.agentHook
				? { enabled: true, label: state.agentHook.label }
				: null,
			capabilities: { fetch: canFetch(ctx) },
		});
	});

	api.post("/fetch", async (c) => {
		const ctx = state.ctx as StoreContext;
		if (!canFetch(ctx)) {
			return c.json(
				{ error: `storage: ${ctx.backend.kind} doesn't support fetch` },
				501,
			);
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
		const task = await createTask(
			body as { title: string },
			state.ctx as StoreContext,
		);
		return c.json(toWireTask(task), 201);
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
				return c.json(
					{ error: result.body || `hook returned ${result.status}` },
					502,
				);
			}
			return c.json({ ok: true });
		} catch (err) {
			return c.json({ error: (err as Error).message }, 502);
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

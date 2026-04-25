import {
	createTask,
	deleteTask,
	getTask,
	listTasks,
	moveTask,
	type StoreContext,
	updateTask,
} from "@ordna/core";
import { Hono } from "hono";
import { toWireTask } from "../shared/types.js";
import { type AgentHookConfig, postAgent } from "./agent.js";

export function buildApiRoutes(
	ctx: StoreContext,
	agentHook: AgentHookConfig | null,
): Hono {
	const api = new Hono();

	api.get("/config", (c) =>
		c.json({
			...ctx.config,
			agentHook: agentHook ? { enabled: true, label: agentHook.label } : null,
		}),
	);

	api.get("/tasks", async (c) => {
		const tasks = await listTasks(ctx);
		return c.json(tasks.map(toWireTask));
	});

	api.get("/tasks/:id", async (c) => {
		const task = await getTask(c.req.param("id"), ctx);
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
		const task = await createTask(body as { title: string }, ctx);
		return c.json(toWireTask(task), 201);
	});

	api.patch("/tasks/:id", async (c) => {
		const id = c.req.param("id");
		const patch = await c.req.json();
		try {
			const task = await updateTask(id, patch, ctx);
			return c.json(toWireTask(task));
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	api.post("/tasks/:id/move", async (c) => {
		const id = c.req.param("id");
		const { status } = (await c.req.json()) as { status: string };
		try {
			const task = await moveTask(id, status, ctx);
			return c.json(toWireTask(task));
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	api.post("/tasks/:id/agent", async (c) => {
		if (!agentHook) return c.json({ error: "agent hook not configured" }, 501);
		const task = await getTask(c.req.param("id"), ctx);
		if (!task) return c.json({ error: "not found" }, 404);
		try {
			const result = await postAgent(agentHook, task, {
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
			await deleteTask(c.req.param("id"), ctx);
			return c.body(null, 204);
		} catch (error) {
			return c.json({ error: (error as Error).message }, 404);
		}
	});

	return api;
}

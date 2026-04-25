import type { Task } from "@ordna/core";

export interface AgentHookConfig {
	url: string;
	label: string;
	headers: Record<string, string>;
}

export function loadAgentHook(): AgentHookConfig | null {
	const url = process.env.ORDNA_AGENT_HOOK_URL;
	if (!url) return null;
	const label = process.env.ORDNA_AGENT_HOOK_LABEL ?? "Agent";
	const headers: Record<string, string> = {};
	const rawHeaders = process.env.ORDNA_AGENT_HOOK_HEADERS;
	if (rawHeaders) {
		try {
			const parsed = JSON.parse(rawHeaders) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
					if (typeof v === "string") headers[k] = v;
				}
			}
		} catch {
			// Malformed headers are ignored so the hook still works.
		}
	}
	return { url, label, headers };
}

export interface AgentContext {
	tasksDir: string;
	cwd: string;
	schema: string;
}

export async function sendAgent(
	hook: AgentHookConfig,
	task: Task,
	context: AgentContext,
): Promise<{ ok: boolean; status: number; body: string }> {
	const res = await fetch(hook.url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...hook.headers,
		},
		body: JSON.stringify({ action: "agent", task, context }),
	});
	const body = await res.text();
	return { ok: res.ok, status: res.status, body };
}

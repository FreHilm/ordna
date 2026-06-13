import type { OrdnaConfig, Task, TaskCreateInput, TaskUpdateInput } from "@frehilm/ordna-core";

export type { OrdnaConfig, Task, TaskCreateInput, TaskUpdateInput };

export interface AgentHookInfo {
	enabled: boolean;
	label: string;
}

export interface UiCapabilities {
	fetch: boolean;
}

export type UiConfig = OrdnaConfig & {
	agentHook: AgentHookInfo | null;
	capabilities: UiCapabilities;
};

export interface FetchResponse {
	ok: true;
	refsUpdated: number;
	durationMs: number;
}

export type WireTask = Omit<Task, "rawContent">;

export type WsEvent =
	| { type: "added"; task: WireTask }
	| { type: "changed"; task: WireTask }
	| { type: "removed"; id: string };

export function toWireTask(task: Task): WireTask {
	const { rawContent: _rawContent, ...rest } = task;
	return rest;
}

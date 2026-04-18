import type { OrdnaConfig, Task, TaskCreateInput, TaskUpdateInput } from "@ordna/core";

export type { OrdnaConfig, Task, TaskCreateInput, TaskUpdateInput };

export type WireTask = Omit<Task, "rawContent">;

export type WsEvent =
	| { type: "added"; task: WireTask }
	| { type: "changed"; task: WireTask }
	| { type: "removed"; id: string };

export function toWireTask(task: Task): WireTask {
	const { rawContent: _rawContent, ...rest } = task;
	return rest;
}

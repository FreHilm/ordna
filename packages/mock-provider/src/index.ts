/**
 * @frehilm/ordna-mock — throwaway in-memory TaskProvider.
 *
 * Purpose: prove that core's `loadProvider` can dynamically import an
 * external plugin package and successfully construct a `TaskProvider`.
 * Not published. Lives in the workspace so pnpm symlinks it into
 * `node_modules/@frehilm/ordna-mock` and `await import("@frehilm/ordna-mock")`
 * Just Works.
 *
 * Enable by adding to `.ordna/config.yaml`:
 *
 *   provider: mock
 *
 * Then run any CLI command. `init` / `dispose` log markers to stderr so
 * lifecycle wiring (T-023) can be visually verified.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	ListOptions,
	OrdnaConfig,
	Task,
	TaskCreateInput,
	TaskEventListener,
	TaskProvider,
	TaskUpdateInput,
} from "@frehilm/ordna-core";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function logMarker(label: string): void {
	console.error(`[ordna-mock] ${label}`);
}

// Sidecar JSON state file. The in-process data structure is still a
// `Map<string, Task>` (per the agreed shape); this file just lets the map
// survive between separate CLI invocations so the round-trip
// (`ordna create` → `ordna list`) actually shows the task. Lives next to
// `.ordna/config.yaml`, so it stays scoped to the project.
const STATE_FILE = ".ordna/mock-state.json";

interface PersistedState {
	tasks: Task[];
	nextNumber: number;
}

class MockTaskProvider implements TaskProvider {
	readonly kind = "mock";

	private readonly tasks = new Map<string, Task>();
	private nextNumber = 1;
	private readonly statePath: string;

	private readonly listeners = new Set<TaskEventListener>();

	constructor(
		private readonly config: OrdnaConfig,
		cwd: string,
	) {
		this.statePath = join(cwd, STATE_FILE);
	}

	async init(): Promise<void> {
		logMarker("init() invoked");
		this.loadFromDisk();
	}

	async dispose(): Promise<void> {
		logMarker("dispose() invoked");
		this.listeners.clear();
	}

	private loadFromDisk(): void {
		if (!existsSync(this.statePath)) return;
		try {
			const raw = readFileSync(this.statePath, "utf8");
			const state = JSON.parse(raw) as PersistedState;
			this.tasks.clear();
			for (const t of state.tasks) this.tasks.set(t.id, t);
			this.nextNumber = state.nextNumber;
		} catch {
			// Corrupt state file — start fresh; the next write will overwrite.
		}
	}

	private saveToDisk(): void {
		mkdirSync(dirname(this.statePath), { recursive: true });
		const state: PersistedState = {
			tasks: [...this.tasks.values()],
			nextNumber: this.nextNumber,
		};
		writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf8");
	}

	async list(options: ListOptions = {}): Promise<Task[]> {
		let out = [...this.tasks.values()];
		if (options.status) out = out.filter((t) => t.status === options.status);
		if (options.assignee)
			out = out.filter((t) => t.assignee === options.assignee);
		if (options.tag) {
			const tag = options.tag;
			out = out.filter((t) => t.tags.includes(tag));
		}
		out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
		return out;
	}

	async get(id: string): Promise<Task | null> {
		return this.tasks.get(id) ?? null;
	}

	async create(input: TaskCreateInput): Promise<Task> {
		const id = this.allocateId();
		const status = input.status ?? this.config.statuses[0];
		if (!status) throw new Error("config has no statuses defined");
		const now = today();
		const task: Task = {
			id,
			title: input.title,
			status,
			assignee: input.assignee ?? null,
			priority: input.priority ?? null,
			tags: input.tags ?? [],
			depends_on: input.depends_on ?? [],
			created_at: now,
			updated_at: now,
			sections: [],
			extra_frontmatter: {},
		};
		this.tasks.set(id, task);
		this.saveToDisk();
		this.emit({ type: "added", task });
		return task;
	}

	async update(id: string, patch: TaskUpdateInput): Promise<Task> {
		const existing = this.tasks.get(id);
		if (!existing) throw new Error(`task ${id} not found`);
		const next: Task = {
			...existing,
			title: patch.title ?? existing.title,
			status: patch.status ?? existing.status,
			assignee:
				patch.assignee !== undefined ? patch.assignee : existing.assignee,
			priority:
				patch.priority !== undefined ? patch.priority : existing.priority,
			tags: patch.tags ?? existing.tags,
			depends_on: patch.depends_on ?? existing.depends_on,
			sections: patch.sections ?? existing.sections,
			updated_at: today(),
		};
		this.tasks.set(id, next);
		this.saveToDisk();
		this.emit({ type: "changed", task: next });
		return next;
	}

	async move(id: string, status: string): Promise<Task> {
		return this.update(id, { status });
	}

	async delete(id: string): Promise<void> {
		const existing = this.tasks.get(id);
		if (!existing) throw new Error(`task ${id} not found`);
		this.tasks.delete(id);
		this.saveToDisk();
		this.emit({ type: "removed", id, filePath: "" });
	}

	watch(listener: TaskEventListener): () => Promise<void> {
		this.listeners.add(listener);
		return async () => {
			this.listeners.delete(listener);
		};
	}

	private allocateId(): string {
		const padded = String(this.nextNumber++).padStart(
			this.config.zeroPaddedIds,
			"0",
		);
		return `${this.config.idPrefix}-${padded}`;
	}

	private emit(event: Parameters<TaskEventListener>[0]): void {
		for (const listener of this.listeners) listener(event);
	}
}

/**
 * The plugin contract: every `@frehilm/ordna-<name>` package must export
 * this factory. Core's `loadProvider` calls it with the resolved
 * `OrdnaConfig` and the project `cwd`.
 */
export function createProvider(
	config: OrdnaConfig,
	cwd: string,
): TaskProvider {
	return new MockTaskProvider(config, cwd);
}

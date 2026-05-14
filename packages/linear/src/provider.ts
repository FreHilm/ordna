import type {
	ListOptions,
	OrdnaConfig,
	Task,
	TaskCreateInput,
	TaskEventListener,
	TaskProvider,
	TaskUpdateInput,
} from "@frehilm/ordna-core";
import { LinearClient } from "./client.js";
import {
	issueToTask,
	linearIdentifierToOrdnaId,
	ordnaIdToLinearIdentifier,
} from "./map.js";
import type { LinearIssue } from "./schema.js";
import {
	type SubscriptionHandle,
	subscribeToIssues,
} from "./subscription.js";

interface LinearConfig {
	apiKey: string;
	endpoint?: string;
	wsEndpoint?: string;
	teamId: string;
	pollIntervalMs: number;
}

export interface LinearTaskProviderOptions {
	/** Override for tests — inject a stubbed fetch. */
	fetch?: typeof fetch;
	/**
	 * Override for tests — inject a stubbed graphql-ws WebSocket impl
	 * or `null` to disable subscriptions entirely (force polling).
	 */
	subscribe?: typeof subscribeToIssues | null;
}

export class LinearTaskProvider implements TaskProvider {
	readonly kind = "linear";

	private readonly client: LinearClient;
	private readonly linear: LinearConfig;
	private readonly options: LinearTaskProviderOptions;
	private teamIdentifierPrefix = "";
	private active = true;

	// Watch state. Subscription and polling are mutually exclusive at
	// runtime: we try the subscription first; if it fails to establish,
	// we drop to polling. Either way, the listener-facing surface is
	// identical (TaskEvent events through `emit()`).
	private readonly listeners = new Set<TaskEventListener>();
	private subscription: SubscriptionHandle | null = null;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private lastSnapshot = new Map<string, Task>();
	private watchStarted = false;

	constructor(
		private readonly config: OrdnaConfig,
		_cwd: string,
		options: LinearTaskProviderOptions = {},
	) {
		this.linear = parseLinearConfig(config);
		this.client = new LinearClient({
			apiKey: this.linear.apiKey,
			...(this.linear.endpoint ? { endpoint: this.linear.endpoint } : {}),
			...(options.fetch ? { fetch: options.fetch } : {}),
		});
		this.options = options;
	}

	async init(): Promise<void> {
		// One round-trip discovers the team's workflow states (so the
		// board uses Linear's columns) and the team identifier prefix
		// (so `ordnaIdToLinearIdentifier` can re-attach it on `get`).
		// If auth is bad, this is where it explodes — with a clear
		// "Linear 401 Unauthorized" surfacing to the user.
		const states = await this.client.listTeamStates(this.linear.teamId);
		if (states.length > 0) {
			const ordered = [...states]
				.sort((a, b) => a.position - b.position)
				.map((s) => s.name.toLowerCase());
			// Mutate the shared config object so core's StoreContext picks
			// up Linear's columns on the next render.
			this.config.statuses = ordered;
		}
		// We don't have a direct "give me the team prefix" query in our
		// fragment set — derive it from any one issue's identifier on
		// first list(), or assume it's the upper-case team key. For v1
		// we trust the user's config: the team prefix can be inferred
		// from the first issue we encounter. Until then, fall back to
		// using the Ordna id verbatim in get().
	}

	async dispose(): Promise<void> {
		this.active = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.subscription) {
			try {
				await this.subscription.close();
			} catch {
				// best-effort
			}
			this.subscription = null;
		}
		this.listeners.clear();
		this.lastSnapshot.clear();
	}

	async list(options: ListOptions = {}): Promise<Task[]> {
		const issues = await this.client.listIssues({ teamId: this.linear.teamId });
		this.cacheTeamPrefix(issues);
		let tasks = issues.map((i) => this.toTask(i));
		if (options.status) tasks = tasks.filter((t) => t.status === options.status);
		if (options.assignee) {
			const a = options.assignee;
			tasks = tasks.filter((t) => t.assignee === a);
		}
		if (options.tag) {
			const tag = options.tag;
			tasks = tasks.filter((t) => t.tags.includes(tag));
		}
		tasks.sort((a, b) =>
			a.id.localeCompare(b.id, undefined, { numeric: true }),
		);
		return tasks;
	}

	async get(id: string): Promise<Task | null> {
		const identifier = this.teamIdentifierPrefix
			? ordnaIdToLinearIdentifier(id, this.teamIdentifierPrefix, this.config)
			: id;
		const issue = await this.client.getIssueByIdentifier(identifier);
		if (!issue) return null;
		this.cacheTeamPrefix([issue]);
		return this.toTask(issue);
	}

	// Write methods are deferred to the 0.2.x follow-up, mirroring Jira.
	async create(_input: TaskCreateInput): Promise<Task> {
		throw new Error(
			"@frehilm/ordna-linear: create() is not implemented in 0.1.x (read-only milestone). Use Linear's own UI to create issues.",
		);
	}

	async update(_id: string, _patch: TaskUpdateInput): Promise<Task> {
		throw new Error(
			"@frehilm/ordna-linear: update() is not implemented in 0.1.x (read-only milestone).",
		);
	}

	async move(_id: string, _status: string): Promise<Task> {
		throw new Error(
			"@frehilm/ordna-linear: move() is not implemented in 0.1.x (read-only milestone). Use Linear's own UI to transition issues.",
		);
	}

	async delete(_id: string): Promise<void> {
		throw new Error(
			"@frehilm/ordna-linear: delete() is not implemented in 0.1.x (read-only milestone).",
		);
	}

	watch(listener: TaskEventListener): () => Promise<void> {
		this.listeners.add(listener);
		if (!this.watchStarted && this.active) {
			this.watchStarted = true;
			void this.startWatch();
		}
		return async () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				await this.stopWatch();
			}
		};
	}

	// ---------------- internals ----------------

	private toTask(issue: LinearIssue): Task {
		return issueToTask(issue, {
			config: this.config,
			teamId: this.linear.teamId,
		});
	}

	private cacheTeamPrefix(issues: LinearIssue[]): void {
		// Lazy: the first issue we see carries `<prefix>-<n>`. Remember
		// the prefix so `get()` can map an Ordna id back into the right
		// Linear identifier without an extra round trip.
		if (this.teamIdentifierPrefix) return;
		for (const i of issues) {
			const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(i.identifier);
			if (m?.[1]) {
				this.teamIdentifierPrefix = m[1];
				return;
			}
		}
	}

	private async startWatch(): Promise<void> {
		// Seed the snapshot so the first event burst doesn't classify
		// every existing issue as `added`.
		try {
			const initial = await this.list();
			this.lastSnapshot = new Map(initial.map((t) => [t.id, t]));
		} catch (err) {
			console.error(
				`[ordna-linear] initial list for watch failed: ${(err as Error).message}`,
			);
		}

		// Try subscription first. `options.subscribe === null` disables
		// the WS path entirely (used by tests that want to assert the
		// polling fallback in isolation).
		const subscribeFn =
			this.options.subscribe === null
				? null
				: (this.options.subscribe ?? subscribeToIssues);

		if (subscribeFn) {
			try {
				this.subscription = await subscribeFn(
					{
						apiKey: this.linear.apiKey,
						teamId: this.linear.teamId,
						...(this.linear.wsEndpoint
							? { wsEndpoint: this.linear.wsEndpoint }
							: {}),
					},
					(issue) => this.onSubscriptionIssue(issue),
					(err) => {
						console.error(
							`[ordna-linear] subscription stream error: ${err.message}. Falling back to polling.`,
						);
						void this.fallbackToPolling();
					},
				);
				return; // subscription established
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`[ordna-linear] subscription unavailable (${message}). Using polling.`,
				);
			}
		}

		// Polling fallback.
		this.schedulePoll();
	}

	private async stopWatch(): Promise<void> {
		this.watchStarted = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		if (this.subscription) {
			try {
				await this.subscription.close();
			} catch {
				// best-effort
			}
			this.subscription = null;
		}
	}

	private async fallbackToPolling(): Promise<void> {
		if (this.subscription) {
			try {
				await this.subscription.close();
			} catch {
				/* best-effort */
			}
			this.subscription = null;
		}
		if (!this.pollTimer) this.schedulePoll();
	}

	private onSubscriptionIssue(issue: LinearIssue): void {
		const task = this.toTask(issue);
		const prev = this.lastSnapshot.get(task.id);
		this.lastSnapshot.set(task.id, task);
		if (!prev) {
			this.emit({ type: "added", task });
		} else if (prev.updated_at !== task.updated_at) {
			this.emit({ type: "changed", task });
		}
	}

	private schedulePoll(): void {
		this.pollTimer = setTimeout(() => {
			void this.poll();
		}, this.linear.pollIntervalMs);
		if (this.pollTimer && typeof this.pollTimer === "object") {
			(this.pollTimer as { unref?: () => void }).unref?.();
		}
	}

	private async poll(): Promise<void> {
		if (!this.active || this.listeners.size === 0) {
			this.pollTimer = null;
			return;
		}
		try {
			const issues = await this.client.listIssues({
				teamId: this.linear.teamId,
			});
			this.cacheTeamPrefix(issues);
			const next = new Map<string, Task>();
			for (const issue of issues) {
				const task = this.toTask(issue);
				next.set(task.id, task);
			}
			this.diffAndEmit(next);
			this.lastSnapshot = next;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[ordna-linear] poll failed: ${message}`);
		} finally {
			if (this.active && this.listeners.size > 0) this.schedulePoll();
			else this.pollTimer = null;
		}
	}

	private diffAndEmit(next: Map<string, Task>): void {
		for (const [id, task] of next) {
			if (!this.lastSnapshot.has(id)) {
				this.emit({ type: "added", task });
				continue;
			}
			const prev = this.lastSnapshot.get(id);
			if (prev && prev.updated_at !== task.updated_at) {
				this.emit({ type: "changed", task });
			}
		}
		for (const [id] of this.lastSnapshot) {
			if (!next.has(id)) {
				this.emit({ type: "removed", id, filePath: "" });
			}
		}
	}

	private emit(event: Parameters<TaskEventListener>[0]): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[ordna-linear] listener threw: ${message}`);
			}
		}
	}
}

function parseLinearConfig(config: OrdnaConfig): LinearConfig {
	const raw = (config as unknown as { linear?: unknown }).linear;
	if (raw === null || typeof raw !== "object") {
		throw new Error(
			"ordna-linear: missing `linear:` config block in .ordna/config.yaml. See https://github.com/FreHilm/ordna/tree/main/packages/linear#config",
		);
	}
	const l = raw as Record<string, unknown>;

	const apiKeyEnv = required(l.apiKeyEnv, "linear.apiKeyEnv");
	const teamId = required(l.teamId, "linear.teamId");
	const endpoint = typeof l.endpoint === "string" ? l.endpoint : undefined;
	const wsEndpoint =
		typeof l.wsEndpoint === "string" ? l.wsEndpoint : undefined;
	const pollIntervalMs =
		typeof l.pollIntervalMs === "number" && l.pollIntervalMs > 0
			? l.pollIntervalMs
			: 30000;

	const apiKey = process.env[apiKeyEnv];
	if (!apiKey) {
		throw new Error(
			`ordna-linear: env var \`${apiKeyEnv}\` is not set. Generate a Linear API key at https://linear.app/settings/api and export it before running Ordna.`,
		);
	}

	return {
		apiKey,
		teamId,
		pollIntervalMs,
		...(endpoint ? { endpoint } : {}),
		...(wsEndpoint ? { wsEndpoint } : {}),
	};
}

function required(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`ordna-linear: \`${name}\` is required in .ordna/config.yaml`);
	}
	return value;
}

// Re-exported for the index module.
export { linearIdentifierToOrdnaId, ordnaIdToLinearIdentifier };

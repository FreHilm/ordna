import type {
	ListOptions,
	OrdnaConfig,
	Task,
	TaskCreateInput,
	TaskEventListener,
	TaskProvider,
	TaskUpdateInput,
} from "@frehilm/ordna-core";
import { JiraClient } from "./client.js";
import {
	type CustomFieldMap,
	issueToTask,
	ordnaIdToJiraKey,
} from "./map.js";
import type { JiraIssue } from "./schema.js";

/**
 * Validated, narrowed view of `config.jira`. See `parseJiraConfig` for
 * the runtime checks; we keep the type internal so the public surface
 * stays the standard `OrdnaConfig`.
 */
interface JiraConfig {
	baseUrl: string;
	email: string;
	apiToken: string;
	projectKey: string;
	jql: string;
	pollIntervalMs: number;
}

/**
 * Fields the plugin requests on every search/get. Custom field IDs are
 * appended at init time once we've discovered them.
 */
const BASE_FIELDS = [
	"summary",
	"description",
	"status",
	"assignee",
	"priority",
	"labels",
	"issuelinks",
	"created",
	"updated",
];

export class JiraTaskProvider implements TaskProvider {
	readonly kind = "jira";

	private readonly client: JiraClient;
	private readonly jira: JiraConfig;
	private customFields: CustomFieldMap = {};
	private fieldsToFetch: string[] = [...BASE_FIELDS];
	private active = true;

	// Watchers: each call to `watch()` registers a listener and starts (or
	// re-uses) the single polling loop. The loop stops when the last
	// listener unsubscribes — or when `dispose()` is called.
	private readonly listeners = new Set<TaskEventListener>();
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private lastSnapshot = new Map<string, Task>();

	constructor(
		private readonly config: OrdnaConfig,
		_cwd: string,
	) {
		this.jira = parseJiraConfig(config);
		this.client = new JiraClient({
			baseUrl: this.jira.baseUrl,
			email: this.jira.email,
			apiToken: this.jira.apiToken,
		});
	}

	/**
	 * Startup work that wants to fail fast and visibly:
	 *
	 *  1. Validate auth (an unauthorised /myself returns 401 with a clear body).
	 *  2. Discover custom field IDs for sprint / story points / epic.
	 *  3. Discover the project's workflow statuses and overwrite
	 *     `config.statuses` so the board uses Jira's native column names.
	 *
	 * Errors propagate — `createContext` in core surfaces them straight to
	 * the user, which is exactly the UX we want for "your token expired".
	 */
	async init(): Promise<void> {
		await this.discoverCustomFields();
		await this.discoverStatuses();
	}

	async dispose(): Promise<void> {
		this.active = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		this.listeners.clear();
		this.lastSnapshot.clear();
	}

	async list(options: ListOptions = {}): Promise<Task[]> {
		const issues = await this.client.searchIssues(
			this.jira.jql,
			this.fieldsToFetch,
		);
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
		// Resolve `T-123` back to `<projectKey>-123` for the Jira lookup.
		const key = ordnaIdToJiraKey(id, this.jira.projectKey, this.config);
		try {
			const issue = await this.client.getIssue(key, this.fieldsToFetch);
			return this.toTask(issue);
		} catch (err) {
			// 404 → null (matches FileTaskProvider semantics). Surface
			// everything else.
			if (err instanceof Error && /\b404\b/.test(err.message)) return null;
			throw err;
		}
	}

	// Write methods are part of the next milestone. Stub them so a
	// misconfigured user sees a clear error rather than a silent no-op.
	async create(_input: TaskCreateInput): Promise<Task> {
		throw new Error(
			"@frehilm/ordna-jira: create() is not implemented in 0.1.x (read-only milestone). Use Jira's own UI to create issues.",
		);
	}

	async update(_id: string, _patch: TaskUpdateInput): Promise<Task> {
		throw new Error(
			"@frehilm/ordna-jira: update() is not implemented in 0.1.x (read-only milestone).",
		);
	}

	async move(_id: string, _status: string): Promise<Task> {
		throw new Error(
			"@frehilm/ordna-jira: move() is not implemented in 0.1.x (read-only milestone). Use Jira's own UI to transition issues.",
		);
	}

	async delete(_id: string): Promise<void> {
		throw new Error(
			"@frehilm/ordna-jira: delete() is not implemented in 0.1.x (read-only milestone).",
		);
	}

	watch(listener: TaskEventListener): () => Promise<void> {
		this.listeners.add(listener);
		if (this.pollTimer === null && this.active) this.schedulePoll();
		return async () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0 && this.pollTimer !== null) {
				clearTimeout(this.pollTimer);
				this.pollTimer = null;
			}
		};
	}

	private toTask(issue: JiraIssue): Task {
		return issueToTask(issue, {
			config: this.config,
			baseUrl: this.jira.baseUrl,
			customFields: this.customFields,
		});
	}

	private schedulePoll(): void {
		this.pollTimer = setTimeout(() => {
			void this.poll();
		}, this.jira.pollIntervalMs);
		// Don't keep the Node process alive just for the poll timer; the
		// host (web server, TUI) is what owns the lifetime.
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
			const issues = await this.client.searchIssues(
				this.jira.jql,
				this.fieldsToFetch,
			);
			const next = new Map<string, Task>();
			for (const issue of issues) {
				const task = this.toTask(issue);
				next.set(task.id, task);
			}
			this.diffAndEmit(next);
			this.lastSnapshot = next;
		} catch (err) {
			// Watcher errors should not kill the loop — surface to stderr
			// and try again on the next tick. A future improvement could
			// expose the error to listeners via a separate event type.
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[ordna-jira] poll failed: ${message}`);
		} finally {
			if (this.active && this.listeners.size > 0) this.schedulePoll();
			else this.pollTimer = null;
		}
	}

	private diffAndEmit(next: Map<string, Task>): void {
		// added: in next, not in lastSnapshot
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
		// removed: in lastSnapshot, not in next
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
				console.error(`[ordna-jira] listener threw: ${message}`);
			}
		}
	}

	private async discoverCustomFields(): Promise<void> {
		const all = await this.client.listFields();
		for (const f of all) {
			if (!f.custom) continue;
			const name = f.name.toLowerCase();
			if (name === "sprint" && !this.customFields.sprint) {
				this.customFields.sprint = f.id;
			} else if (
				(name === "story points" || name === "story point estimate") &&
				!this.customFields.storyPoints
			) {
				this.customFields.storyPoints = f.id;
			} else if (
				(name === "epic link" || name === "parent link") &&
				!this.customFields.epic
			) {
				this.customFields.epic = f.id;
			}
		}
		this.fieldsToFetch = [
			...BASE_FIELDS,
			this.customFields.sprint,
			this.customFields.storyPoints,
			this.customFields.epic,
		].filter((s): s is string => typeof s === "string");
	}

	private async discoverStatuses(): Promise<void> {
		const groups = await this.client.listProjectStatuses(this.jira.projectKey);
		// Union across issue types, preserving the order they first appear.
		// Lowercased to match the rest of Ordna's status conventions.
		const seen = new Set<string>();
		const ordered: string[] = [];
		for (const group of groups) {
			for (const s of group.statuses) {
				const name = s.name.toLowerCase();
				if (seen.has(name)) continue;
				seen.add(name);
				ordered.push(name);
			}
		}
		if (ordered.length > 0) {
			// Mutate the shared config object. The same reference is held by
			// core's StoreContext, so the board picks up the new column set
			// on first render.
			this.config.statuses = ordered;
		}
	}
}

function parseJiraConfig(config: OrdnaConfig): JiraConfig {
	const raw = (config as unknown as { jira?: unknown }).jira;
	if (raw === null || typeof raw !== "object") {
		throw new Error(
			'ordna-jira: missing `jira:` config block in .ordna/config.yaml. See https://github.com/FreHilm/ordna/tree/main/packages/jira#config',
		);
	}
	const j = raw as Record<string, unknown>;

	const baseUrl = required(j.baseUrl, "jira.baseUrl");
	const email = required(j.email, "jira.email");
	const apiTokenEnv = required(j.apiTokenEnv, "jira.apiTokenEnv");
	const projectKey = required(j.projectKey, "jira.projectKey");
	const jql =
		typeof j.jql === "string" && j.jql.length > 0
			? j.jql
			: `project = ${projectKey} AND statusCategory != Done`;
	const pollIntervalMs =
		typeof j.pollIntervalMs === "number" && j.pollIntervalMs > 0
			? j.pollIntervalMs
			: 30000;

	const apiToken = process.env[apiTokenEnv];
	if (!apiToken) {
		throw new Error(
			`ordna-jira: env var \`${apiTokenEnv}\` is not set. Generate a Jira API token at https://id.atlassian.com/manage-profile/security/api-tokens and export it before running Ordna.`,
		);
	}

	return {
		baseUrl,
		email,
		apiToken,
		projectKey,
		jql,
		pollIntervalMs,
	};
}

function required(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`ordna-jira: \`${name}\` is required in .ordna/config.yaml`);
	}
	return value;
}

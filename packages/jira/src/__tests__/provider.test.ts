import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OrdnaConfig } from "@frehilm/ordna-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProvider } from "../index.js";

/**
 * Spin up a tiny in-memory Jira mock. Routes implemented:
 *   GET  /rest/api/3/field
 *   GET  /rest/api/3/project/{key}/statuses
 *   POST /rest/api/3/search
 *   GET  /rest/api/3/issue/{key}?fields=...
 *
 * Each test gets a fresh server, seeded with a list of issues plus the
 * canonical field-discovery and status-discovery responses.
 */

interface MockState {
	issues: Record<string, unknown>;
	statuses: string[]; // ordered list of status names
	rateLimitOnce?: boolean; // when true, the next /search returns 429
}

function startMockJira(state: MockState): Promise<{
	server: Server;
	baseUrl: string;
}> {
	return new Promise((resolve) => {
		let consumed429 = false;
		const server = createServer((req, res) => {
			const url = req.url ?? "";
			res.setHeader("Content-Type", "application/json");

			if (url.startsWith("/rest/api/3/field")) {
				res.end(
					JSON.stringify([
						{ id: "summary", name: "Summary", custom: false },
						{
							id: "customfield_10020",
							name: "Sprint",
							custom: true,
						},
						{
							id: "customfield_10026",
							name: "Story Points",
							custom: true,
						},
						{
							id: "customfield_10014",
							name: "Epic Link",
							custom: true,
						},
					]),
				);
				return;
			}

			if (url.match(/\/rest\/api\/3\/project\/[^/]+\/statuses/)) {
				res.end(
					JSON.stringify([
						{
							id: "10000",
							name: "Story",
							statuses: state.statuses.map((name) => ({ name })),
						},
					]),
				);
				return;
			}

			if (url === "/rest/api/3/search" && req.method === "POST") {
				if (state.rateLimitOnce && !consumed429) {
					consumed429 = true;
					res.statusCode = 429;
					res.setHeader("Retry-After", "0");
					res.end(JSON.stringify({ errorMessages: ["Rate limited"] }));
					return;
				}
				const issues = Object.values(state.issues);
				res.end(
					JSON.stringify({
						issues,
						total: issues.length,
						startAt: 0,
						maxResults: 100,
					}),
				);
				return;
			}

			const issueMatch = url.match(/^\/rest\/api\/3\/issue\/([^?]+)/);
			if (issueMatch) {
				const key = decodeURIComponent(issueMatch[1] ?? "");
				const issue = state.issues[key];
				if (!issue) {
					res.statusCode = 404;
					res.end(
						JSON.stringify({
							errorMessages: [`Issue ${key} not found`],
						}),
					);
					return;
				}
				res.end(JSON.stringify(issue));
				return;
			}

			res.statusCode = 404;
			res.end(JSON.stringify({ errorMessages: ["Not found"] }));
		});

		server.listen(0, () => {
			const addr = server.address() as AddressInfo;
			resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
		});
	});
}

function makeIssue(
	key: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		key,
		fields: {
			summary: `Issue ${key}`,
			description: null,
			status: { name: "To Do" },
			assignee: null,
			priority: { name: "Medium" },
			labels: [],
			issuelinks: [],
			created: "2026-05-01T00:00:00.000+0000",
			updated: "2026-05-09T00:00:00.000+0000",
			...overrides,
		},
	};
}

function makeConfig(jiraBlock: Record<string, unknown>): OrdnaConfig {
	return {
		tasksDir: "tasks",
		schema: "ordna",
		statuses: ["todo", "doing", "done"],
		idPrefix: "T",
		zeroPaddedIds: 3,
		webPort: 7420,
		provider: "jira",
		jira: jiraBlock,
	} as unknown as OrdnaConfig;
}

describe("JiraTaskProvider (integration via stubbed REST)", () => {
	let server: Server | null = null;
	let baseUrl = "";

	beforeEach(() => {
		process.env.JIRA_TOKEN_TEST = "fake-token";
	});

	afterEach(async () => {
		delete process.env.JIRA_TOKEN_TEST;
		if (server) {
			await new Promise<void>((r) => server?.close(() => r()));
			server = null;
		}
	});

	async function setup(state: MockState): Promise<ReturnType<typeof createProvider>> {
		const stub = await startMockJira(state);
		server = stub.server;
		baseUrl = stub.baseUrl;
		const config = makeConfig({
			baseUrl,
			email: "test@example.com",
			apiTokenEnv: "JIRA_TOKEN_TEST",
			projectKey: "ENG",
			pollIntervalMs: 1000,
		});
		const provider = createProvider(config, "/tmp/jira-test");
		await provider.init?.();
		return provider;
	}

	it("init() discovers custom fields and project statuses", async () => {
		const config = makeConfig({
			baseUrl: "",
			email: "test@example.com",
			apiTokenEnv: "JIRA_TOKEN_TEST",
			projectKey: "ENG",
			pollIntervalMs: 1000,
		});
		const stub = await startMockJira({
			issues: {},
			statuses: ["To Do", "In Progress", "Code Review", "Done"],
		});
		server = stub.server;
		(config as unknown as { jira: { baseUrl: string } }).jira.baseUrl =
			stub.baseUrl;

		const provider = createProvider(config, "/tmp/jira-test");
		await provider.init?.();

		// After init, the shared config's `statuses` is overwritten with
		// Jira's workflow order (lowercased).
		expect(config.statuses).toEqual([
			"to do",
			"in progress",
			"code review",
			"done",
		]);
	});

	it("list() returns mapped tasks for the seeded issues", async () => {
		const provider = await setup({
			issues: {
				"ENG-1": makeIssue("ENG-1", { summary: "First" }),
				"ENG-2": makeIssue("ENG-2", {
					summary: "Second",
					status: { name: "Done" },
					assignee: { displayName: "Bob" },
				}),
			},
			statuses: ["To Do", "In Progress", "Done"],
		});

		const tasks = await provider.list();
		expect(tasks).toHaveLength(2);
		expect(tasks[0]?.id).toBe("T-001");
		expect(tasks[0]?.title).toBe("First");
		expect(tasks[1]?.id).toBe("T-002");
		expect(tasks[1]?.status).toBe("done");
		expect(tasks[1]?.assignee).toBe("Bob");
		expect(tasks[1]?.remote?.url).toBe(`${baseUrl}/browse/ENG-2`);
	});

	it("get() resolves the Ordna id back to a Jira key", async () => {
		const provider = await setup({
			issues: {
				"ENG-42": makeIssue("ENG-42", { summary: "Cached" }),
			},
			statuses: ["To Do", "Done"],
		});

		const task = await provider.get("T-042");
		expect(task).not.toBeNull();
		expect(task?.title).toBe("Cached");
		expect(task?.remote?.externalId).toBe("ENG-42");
	});

	it("get() returns null for a 404 (issue not found)", async () => {
		const provider = await setup({
			issues: {},
			statuses: ["To Do", "Done"],
		});
		const task = await provider.get("T-999");
		expect(task).toBeNull();
	});

	it("retries on 429 and succeeds on the next attempt", async () => {
		const provider = await setup({
			issues: { "ENG-1": makeIssue("ENG-1") },
			statuses: ["To Do", "Done"],
			rateLimitOnce: true,
		});
		const tasks = await provider.list();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe("T-001");
	});

	it("dispose() is idempotent and clears any polling timer", async () => {
		const provider = await setup({
			issues: {},
			statuses: ["To Do", "Done"],
		});
		// Register a watcher so the poll timer is created, then immediately
		// dispose. Calling dispose twice must not throw.
		provider.watch(() => {});
		await provider.dispose?.();
		await expect(provider.dispose?.()).resolves.toBeUndefined();
	});
});

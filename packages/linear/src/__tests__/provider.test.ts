import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OrdnaConfig } from "@frehilm/ordna-core";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import { createProvider } from "../index.js";
import type { LinearIssue, LinearWorkflowState } from "../schema.js";

/**
 * Stubbed Linear GraphQL endpoint. Single POST at /graphql; we
 * dispatch on a substring of the incoming query to decide what to
 * return. Crude but enough to exercise the read paths.
 */
interface MockState {
	issues: LinearIssue[];
	states: LinearWorkflowState[];
	rateLimitOnce?: boolean;
}

function startMockLinear(
	state: MockState,
): Promise<{ server: Server; endpoint: string }> {
	return new Promise((resolve) => {
		let consumed429 = false;
		const server = createServer((req, res) => {
			let data = "";
			req.on("data", (c) => {
				data += c;
			});
			req.on("end", () => {
				if (req.method !== "POST" || !req.url?.includes("/graphql")) {
					res.statusCode = 404;
					res.end();
					return;
				}

				if (state.rateLimitOnce && !consumed429) {
					consumed429 = true;
					res.statusCode = 429;
					res.setHeader("Retry-After", "0");
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify({ errors: [{ message: "Rate limited" }] }));
					return;
				}

				let body: { query: string; variables?: Record<string, unknown> } = {
					query: "",
				};
				try {
					body = JSON.parse(data);
				} catch {
					// pass-through; we'll fail to match anything
				}

				res.setHeader("Content-Type", "application/json");

				if (body.query.includes("TeamStates")) {
					res.end(
						JSON.stringify({
							data: {
								team: {
									id: body.variables?.teamId ?? "team-uuid",
									states: { nodes: state.states },
								},
							},
						}),
					);
					return;
				}

				if (body.query.includes("query Issue(")) {
					const id = body.variables?.id as string | undefined;
					const issue = state.issues.find((i) => i.identifier === id) ?? null;
					res.end(JSON.stringify({ data: { issue } }));
					return;
				}

				if (body.query.includes("query Issues(")) {
					res.end(
						JSON.stringify({
							data: {
								issues: {
									nodes: state.issues,
									pageInfo: { hasNextPage: false, endCursor: null },
								},
							},
						}),
					);
					return;
				}

				res.statusCode = 400;
				res.end(
					JSON.stringify({
						errors: [{ message: `unrecognised query: ${body.query.slice(0, 60)}` }],
					}),
				);
			});
		});

		server.listen(0, () => {
			const addr = server.address() as AddressInfo;
			resolve({
				server,
				endpoint: `http://127.0.0.1:${addr.port}/graphql`,
			});
		});
	});
}

function makeIssue(
	identifier: string,
	overrides: Partial<LinearIssue> = {},
): LinearIssue {
	return {
		id: `issue-${identifier}`,
		identifier,
		title: `Issue ${identifier}`,
		description: null,
		priority: 3,
		url: `https://linear.app/acme/issue/${identifier}`,
		createdAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-09T00:00:00.000Z",
		state: { id: "state-todo", name: "Todo", type: "unstarted" },
		assignee: null,
		labels: { nodes: [] },
		relations: { nodes: [] },
		cycle: null,
		project: null,
		parent: null,
		...overrides,
	};
}

function makeConfig(
	linearBlock: Record<string, unknown>,
): OrdnaConfig {
	return {
		tasksDir: "tasks",
		schema: "ordna",
		statuses: ["todo", "doing", "done"],
		idPrefix: "T",
		zeroPaddedIds: 3,
		webPort: 7420,
		provider: "linear",
		linear: linearBlock,
	} as unknown as OrdnaConfig;
}

describe("LinearTaskProvider (integration via stubbed GraphQL)", () => {
	let server: Server | null = null;
	let endpoint = "";

	beforeEach(() => {
		process.env.LINEAR_API_KEY_TEST = "fake-key";
	});

	afterEach(async () => {
		delete process.env.LINEAR_API_KEY_TEST;
		if (server) {
			await new Promise<void>((r) => server?.close(() => r()));
			server = null;
		}
	});

	async function setup(state: MockState) {
		const stub = await startMockLinear(state);
		server = stub.server;
		endpoint = stub.endpoint;
		const config = makeConfig({
			apiKeyEnv: "LINEAR_API_KEY_TEST",
			teamId: "team-uuid",
			endpoint,
			pollIntervalMs: 1000,
		});
		// Disable the subscription path so tests exercise the documented
		// polling fallback deterministically. Subscription wiring is
		// covered separately by unit tests on the subscribe wrapper.
		const provider = createProvider(config, "/tmp/linear-test");
		(provider as { options?: unknown }).options = { subscribe: null };
		await provider.init?.();
		return { provider, config };
	}

	it("init() discovers team workflow states and overrides config.statuses", async () => {
		const { config } = await setup({
			issues: [],
			states: [
				{ id: "s1", name: "Backlog", position: 0, type: "backlog" },
				{ id: "s2", name: "Todo", position: 1, type: "unstarted" },
				{ id: "s3", name: "In Progress", position: 2, type: "started" },
				{ id: "s4", name: "Done", position: 3, type: "completed" },
			],
		});
		expect(config.statuses).toEqual([
			"backlog",
			"todo",
			"in progress",
			"done",
		]);
	});

	it("list() returns mapped tasks sorted by id", async () => {
		const { provider } = await setup({
			issues: [
				makeIssue("ENG-2", { title: "Second" }),
				makeIssue("ENG-1", { title: "First" }),
			],
			states: [{ id: "s1", name: "Todo", position: 0, type: "unstarted" }],
		});
		const tasks = await provider.list();
		expect(tasks.map((t) => t.id)).toEqual(["T-001", "T-002"]);
		expect(tasks[0]?.title).toBe("First");
		expect(tasks[1]?.remote?.url).toContain("/ENG-2");
	});

	it("get() resolves Ordna id back to a Linear identifier", async () => {
		const { provider } = await setup({
			issues: [makeIssue("ENG-42", { title: "Cached" })],
			states: [{ id: "s1", name: "Todo", position: 0, type: "unstarted" }],
		});
		// Prime the team-prefix cache by listing first.
		await provider.list();
		const task = await provider.get("T-042");
		expect(task).not.toBeNull();
		expect(task?.title).toBe("Cached");
	});

	it("get() returns null when Linear reports no issue", async () => {
		const { provider } = await setup({
			issues: [],
			states: [{ id: "s1", name: "Todo", position: 0, type: "unstarted" }],
		});
		const task = await provider.get("T-999");
		expect(task).toBeNull();
	});

	it("retries on 429 and succeeds on the next attempt", async () => {
		const { provider } = await setup({
			issues: [makeIssue("ENG-1")],
			states: [{ id: "s1", name: "Todo", position: 0, type: "unstarted" }],
			rateLimitOnce: true,
		});
		const tasks = await provider.list();
		expect(tasks).toHaveLength(1);
	});

	it("dispose() is idempotent", async () => {
		const { provider } = await setup({
			issues: [],
			states: [{ id: "s1", name: "Todo", position: 0, type: "unstarted" }],
		});
		await provider.dispose?.();
		await expect(provider.dispose?.()).resolves.toBeUndefined();
	});

	it("write methods throw a clear 'not implemented in 0.1.x' error", async () => {
		const { provider } = await setup({
			issues: [],
			states: [{ id: "s1", name: "Todo", position: 0, type: "unstarted" }],
		});
		await expect(
			provider.create({ title: "nope" }),
		).rejects.toThrow(/not implemented in 0\.1\.x/);
		await expect(
			provider.update("T-1", { title: "x" }),
		).rejects.toThrow(/not implemented in 0\.1\.x/);
		await expect(provider.move("T-1", "done")).rejects.toThrow(
			/not implemented in 0\.1\.x/,
		);
		await expect(provider.delete("T-1")).rejects.toThrow(
			/not implemented in 0\.1\.x/,
		);
	});
});

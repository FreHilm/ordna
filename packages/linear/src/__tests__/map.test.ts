import type { OrdnaConfig } from "@frehilm/ordna-core";
import { describe, expect, it } from "vitest";
import {
	issueToTask,
	linearIdentifierToOrdnaId,
	ordnaIdToLinearIdentifier,
} from "../map.js";
import type { LinearIssue } from "../schema.js";

const baseConfig: OrdnaConfig = {
	tasksDir: "tasks",
	schema: "ordna",
	statuses: ["todo", "doing", "done"],
	idPrefix: "T",
	zeroPaddedIds: 3,
	webPort: 7420,
	provider: "linear",
} as OrdnaConfig;

const baseCtx = { config: baseConfig, teamId: "team-uuid" };

function makeIssue(
	overrides: Partial<LinearIssue> = {},
	identifier = "ENG-7",
): LinearIssue {
	return {
		id: "issue-uuid-1",
		identifier,
		title: "Implement payment flow",
		description: null,
		priority: 2, // high
		url: "https://linear.app/acme/issue/ENG-7",
		createdAt: "2026-04-25T08:12:31.000Z",
		updatedAt: "2026-05-09T13:45:00.000Z",
		state: { id: "state-uuid", name: "In Progress", type: "started" },
		assignee: { id: "user-uuid", displayName: "Alice" },
		labels: { nodes: [{ id: "label-uuid", name: "payments" }] },
		relations: { nodes: [] },
		cycle: null,
		project: null,
		parent: null,
		...overrides,
	};
}

describe("linearIdentifierToOrdnaId / ordnaIdToLinearIdentifier", () => {
	it("rewrites ENG-7 to T-007 under default config", () => {
		expect(linearIdentifierToOrdnaId("ENG-7", baseConfig)).toBe("T-007");
	});

	it("respects custom prefix and padding", () => {
		const cfg = { ...baseConfig, idPrefix: "BUG", zeroPaddedIds: 5 } as OrdnaConfig;
		expect(linearIdentifierToOrdnaId("ENG-42", cfg)).toBe("BUG-00042");
	});

	it("leaves non-standard identifiers verbatim", () => {
		expect(linearIdentifierToOrdnaId("not-a-key", baseConfig)).toBe("not-a-key");
	});

	it("round-trips through ordnaIdToLinearIdentifier", () => {
		expect(ordnaIdToLinearIdentifier("T-007", "ENG", baseConfig)).toBe("ENG-7");
		expect(ordnaIdToLinearIdentifier("T-1234", "PROJ", baseConfig)).toBe("PROJ-1234");
	});
});

describe("issueToTask", () => {
	it("maps the standard fields", () => {
		const task = issueToTask(makeIssue(), baseCtx);
		expect(task.id).toBe("T-007");
		expect(task.title).toBe("Implement payment flow");
		expect(task.status).toBe("in progress");
		expect(task.assignee).toBe("Alice");
		expect(task.priority).toBe("high");
		expect(task.tags).toEqual(["payments"]);
		expect(task.created_at).toBe("2026-04-25");
		expect(task.updated_at).toBe("2026-05-09");
	});

	it("populates remote metadata using the Linear url", () => {
		const task = issueToTask(makeIssue(), baseCtx);
		expect(task.remote).toEqual({
			provider: "linear",
			externalId: "ENG-7",
			url: "https://linear.app/acme/issue/ENG-7",
			extras: {},
		});
	});

	it("maps Linear's priority scale (urgent collapses into high, low keeps low)", () => {
		expect(issueToTask(makeIssue({ priority: 1 }), baseCtx).priority).toBe("high");
		expect(issueToTask(makeIssue({ priority: 2 }), baseCtx).priority).toBe("high");
		expect(issueToTask(makeIssue({ priority: 3 }), baseCtx).priority).toBe(
			"medium",
		);
		expect(issueToTask(makeIssue({ priority: 4 }), baseCtx).priority).toBe("low");
		expect(issueToTask(makeIssue({ priority: 0 }), baseCtx).priority).toBeNull();
	});

	it("extracts depends_on from 'blocks' relations only", () => {
		const task = issueToTask(
			makeIssue({
				relations: {
					nodes: [
						{
							type: "blocks",
							relatedIssue: { identifier: "ENG-3" },
						},
						{
							type: "relates_to",
							relatedIssue: { identifier: "ENG-99" },
						},
						{
							type: "blocks",
							relatedIssue: null,
						},
					],
				},
			}),
			baseCtx,
		);
		expect(task.depends_on).toEqual(["T-003"]);
	});

	it("wraps the description as a single 'Description' section", () => {
		const task = issueToTask(
			makeIssue({ description: "## Goal\n\nShip it." }),
			baseCtx,
		);
		expect(task.sections).toEqual([
			{
				heading: "Description",
				level: 2,
				content: "## Goal\n\nShip it.",
			},
		]);
	});

	it("emits no sections when description is empty or null", () => {
		expect(issueToTask(makeIssue({ description: null }), baseCtx).sections).toEqual(
			[],
		);
		expect(issueToTask(makeIssue({ description: "  " }), baseCtx).sections).toEqual(
			[],
		);
	});

	it("populates extras with cycle / project / parent when present", () => {
		const task = issueToTask(
			makeIssue({
				cycle: { id: "cycle-uuid", name: "Cycle 22" },
				project: { id: "proj-uuid", name: "Checkout v2" },
				parent: { identifier: "ENG-1" },
			}),
			baseCtx,
		);
		expect(task.remote?.extras).toEqual({
			cycle: "Cycle 22",
			project: "Checkout v2",
			parentIssue: "ENG-1",
		});
	});

	it("tolerates a missing assignee", () => {
		const task = issueToTask(makeIssue({ assignee: null }), baseCtx);
		expect(task.assignee).toBeNull();
	});
});

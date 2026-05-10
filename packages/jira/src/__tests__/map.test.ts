import type { OrdnaConfig } from "@frehilm/ordna-core";
import { describe, expect, it } from "vitest";
import { issueToTask, jiraKeyToOrdnaId, ordnaIdToJiraKey } from "../map.js";
import type { JiraIssue } from "../schema.js";

const baseConfig: OrdnaConfig = {
	tasksDir: "tasks",
	schema: "ordna",
	statuses: ["todo", "doing", "done"],
	idPrefix: "T",
	zeroPaddedIds: 3,
	webPort: 7420,
	provider: "jira",
} as OrdnaConfig;

const baseCtx = {
	config: baseConfig,
	baseUrl: "https://acme.atlassian.net",
	customFields: { sprint: "customfield_10020", storyPoints: "customfield_10026" },
};

function makeIssue(overrides: Partial<JiraIssue["fields"]> = {}, key = "ENG-7"): JiraIssue {
	return {
		key,
		fields: {
			summary: "Implement payment flow",
			description: null,
			status: { name: "In Progress" },
			assignee: { displayName: "Alice" },
			priority: { name: "High" },
			labels: ["payments"],
			issuelinks: [],
			created: "2026-04-25T08:12:31.000+0200",
			updated: "2026-05-09T13:45:00.000+0200",
			...overrides,
		},
	};
}

describe("jiraKeyToOrdnaId / ordnaIdToJiraKey", () => {
	it("rewrites ENG-7 to T-007 under default config", () => {
		expect(jiraKeyToOrdnaId("ENG-7", baseConfig)).toBe("T-007");
	});

	it("respects custom prefix and padding", () => {
		const cfg = { ...baseConfig, idPrefix: "BUG", zeroPaddedIds: 5 } as OrdnaConfig;
		expect(jiraKeyToOrdnaId("ENG-42", cfg)).toBe("BUG-00042");
	});

	it("leaves non-standard keys verbatim", () => {
		expect(jiraKeyToOrdnaId("not-a-jira-key", baseConfig)).toBe("not-a-jira-key");
	});

	it("round-trips through ordnaIdToJiraKey", () => {
		expect(ordnaIdToJiraKey("T-007", "ENG", baseConfig)).toBe("ENG-7");
		expect(ordnaIdToJiraKey("T-1234", "PROJ", baseConfig)).toBe("PROJ-1234");
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

	it("populates remote metadata with the issue URL", () => {
		const task = issueToTask(makeIssue(), baseCtx);
		expect(task.remote).toEqual({
			provider: "jira",
			externalId: "ENG-7",
			url: "https://acme.atlassian.net/browse/ENG-7",
			extras: {},
		});
	});

	it("maps Jira's 'Highest' priority to high and 'Lowest' to low", () => {
		const highest = issueToTask(
			makeIssue({ priority: { name: "Highest" } }),
			baseCtx,
		);
		expect(highest.priority).toBe("high");
		const lowest = issueToTask(
			makeIssue({ priority: { name: "Lowest" } }),
			baseCtx,
		);
		expect(lowest.priority).toBe("low");
	});

	it("returns null priority for unknown Jira priority values", () => {
		const task = issueToTask(
			makeIssue({ priority: { name: "Trivial" } }),
			baseCtx,
		);
		expect(task.priority).toBeNull();
	});

	it("extracts depends_on from inward 'Blocks' links", () => {
		const task = issueToTask(
			makeIssue({
				issuelinks: [
					{
						type: { name: "Blocks", inward: "is blocked by" },
						inwardIssue: { key: "ENG-3" },
					},
					{
						type: { name: "Relates" },
						outwardIssue: { key: "ENG-99" },
					},
				],
			}),
			baseCtx,
		);
		expect(task.depends_on).toEqual(["T-003"]);
	});

	it("renders description ADF as a single 'Description' section", () => {
		const description = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Ship it." }],
				},
			],
		};
		const task = issueToTask(
			makeIssue({ description }),
			baseCtx,
		);
		expect(task.sections).toEqual([
			{ heading: "Description", level: 2, content: "Ship it." },
		]);
	});

	it("falls back gracefully when description is null", () => {
		const task = issueToTask(makeIssue({ description: null }), baseCtx);
		expect(task.sections).toEqual([]);
	});

	it("picks the active sprint from the sprint custom field", () => {
		const fields = {
			[baseCtx.customFields.sprint as string]: [
				{ id: 1, name: "Sprint 22", state: "closed" },
				{ id: 2, name: "Sprint 23", state: "active" },
			],
		};
		const task = issueToTask(
			makeIssue(fields as Partial<JiraIssue["fields"]>),
			baseCtx,
		);
		expect(task.remote?.extras?.sprint).toBe("Sprint 23");
	});

	it("reads story points when configured", () => {
		const fields = { [baseCtx.customFields.storyPoints as string]: 5 };
		const task = issueToTask(
			makeIssue(fields as Partial<JiraIssue["fields"]>),
			baseCtx,
		);
		expect(task.remote?.extras?.storyPoints).toBe(5);
	});

	it("tolerates a missing assignee", () => {
		const task = issueToTask(makeIssue({ assignee: null }), baseCtx);
		expect(task.assignee).toBeNull();
	});
});

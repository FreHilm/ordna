import { describe, expect, it } from "vitest";
import { extractAcceptanceCriteria, parseTask, splitSections } from "../parser.js";

const ORDNA_FIXTURE = `---
id: T-001
title: Implement payment flow
status: todo
assignee: null
priority: high
tags: [payments]
depends_on: []
created_at: 2026-04-18
updated_at: 2026-04-18
---

## Goal
Ship the thing.

## Acceptance Criteria
- [ ] Card works
- [x] Apple Pay works

## Notes
Careful with PCI.

## Progress
Kickoff 2026-04-18.
`;

const BACKLOG_FIXTURE = `---
id: task-42
title: Add search
status: To Do
assignee: [fredrik]
priority: medium
labels: [search, backend]
dependencies: [task-10]
createdDate: 2026-04-10
updatedDate: 2026-04-15
---

## Description
Search should work.

## Acceptance Criteria
- [ ] Backend endpoint
- [ ] Frontend input

## Implementation Plan
Use fuzzy matching.
`;

describe("parser — ordna schema", () => {
	it("parses canonical frontmatter and sections", () => {
		const task = parseTask(ORDNA_FIXTURE, "/tmp/T-001.md");
		expect(task.id).toBe("T-001");
		expect(task.title).toBe("Implement payment flow");
		expect(task.status).toBe("todo");
		expect(task.assignee).toBeNull();
		expect(task.priority).toBe("high");
		expect(task.tags).toEqual(["payments"]);
		expect(task.depends_on).toEqual([]);
		expect(task.created_at).toBe("2026-04-18");
		expect(task.sections.map((s) => s.heading)).toEqual([
			"Goal",
			"Acceptance Criteria",
			"Notes",
			"Progress",
		]);
	});

	it("extracts acceptance criteria checkboxes", () => {
		const task = parseTask(ORDNA_FIXTURE, "/tmp/T-001.md");
		const items = extractAcceptanceCriteria(task.sections);
		expect(items).toEqual([
			{ text: "Card works", checked: false },
			{ text: "Apple Pay works", checked: true },
		]);
	});
});

describe("parser — backlog schema", () => {
	it("normalizes labels→tags, dependencies→depends_on, createdDate→created_at", () => {
		const task = parseTask(BACKLOG_FIXTURE, "/tmp/task-42.md");
		expect(task.id).toBe("task-42");
		expect(task.status).toBe("To Do");
		expect(task.assignee).toBe("fredrik");
		expect(task.tags).toEqual(["search", "backend"]);
		expect(task.depends_on).toEqual(["task-10"]);
		expect(task.created_at).toBe("2026-04-10");
		expect(task.updated_at).toBe("2026-04-15");
	});

	it("finds acceptance criteria regardless of sibling section names", () => {
		const task = parseTask(BACKLOG_FIXTURE, "/tmp/task-42.md");
		const items = extractAcceptanceCriteria(task.sections);
		expect(items).toHaveLength(2);
		expect(items.every((i) => !i.checked)).toBe(true);
	});
});

describe("splitSections", () => {
	it("returns empty array on empty input", () => {
		expect(splitSections("")).toEqual([]);
	});

	it("captures preamble before the first ##", () => {
		const sections = splitSections("intro text\n\n## Goal\ncontent");
		expect(sections[0]?.heading).toBe("");
		expect(sections[0]?.content).toBe("intro text");
		expect(sections[1]?.heading).toBe("Goal");
	});
});

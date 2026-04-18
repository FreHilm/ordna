import { describe, expect, it } from "vitest";
import { parseTask } from "../parser.js";
import { serializeTask } from "../writer.js";

const ORDNA_INPUT = `---
id: T-001
title: Implement payment flow
status: todo
assignee: null
priority: high
tags:
  - payments
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
Kickoff.
`;

describe("round-trip — ordna mode", () => {
	it("is stable: parse → write → parse yields equivalent task", () => {
		const a = parseTask(ORDNA_INPUT, "/tmp/T-001.md");
		const serialized = serializeTask(a, "ordna");
		const b = parseTask(serialized, "/tmp/T-001.md");

		expect(b.id).toBe(a.id);
		expect(b.title).toBe(a.title);
		expect(b.status).toBe(a.status);
		expect(b.assignee).toBe(a.assignee);
		expect(b.priority).toBe(a.priority);
		expect(b.tags).toEqual(a.tags);
		expect(b.depends_on).toEqual(a.depends_on);
		expect(b.sections.map((s) => s.heading)).toEqual(a.sections.map((s) => s.heading));
		expect(b.sections.map((s) => s.content)).toEqual(a.sections.map((s) => s.content));
	});
});

describe("round-trip — backlog mode conversion", () => {
	it("writes backlog frontmatter shape when schema=backlog", () => {
		const task = parseTask(ORDNA_INPUT, "/tmp/T-001.md");
		const serialized = serializeTask(task, "backlog");

		expect(serialized).toContain("labels:");
		expect(serialized).toContain("dependencies:");
		expect(serialized).toContain("createdDate:");
		expect(serialized).not.toContain("tags:");
		expect(serialized).not.toContain("depends_on:");
	});

	it("preserves tags content after ordna→backlog→ordna round-trip", () => {
		const a = parseTask(ORDNA_INPUT, "/tmp/T-001.md");
		const backlogSerialized = serializeTask(a, "backlog");
		const b = parseTask(backlogSerialized, "/tmp/T-001.md");
		expect(b.tags).toEqual(a.tags);
		expect(b.depends_on).toEqual(a.depends_on);
	});
});

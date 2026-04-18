import { stringify as stringifyYaml } from "yaml";
import {
	BACKLOG_BODY_HEADINGS,
	ORDNA_BODY_HEADINGS,
	type SchemaMode,
	type Section,
	type Task,
} from "./schema.js";

function buildFrontmatter(task: Task, mode: SchemaMode): Record<string, unknown> {
	const base: Record<string, unknown> = {
		id: task.id,
		title: task.title,
		status: task.status,
	};

	if (mode === "backlog") {
		base.assignee = task.assignee === null ? [] : [task.assignee];
		if (task.priority !== null) base.priority = task.priority;
		base.labels = task.tags;
		base.dependencies = task.depends_on;
		base.createdDate = task.created_at;
		if (task.updated_at) base.updatedDate = task.updated_at;
	} else {
		base.assignee = task.assignee;
		base.priority = task.priority;
		base.tags = task.tags;
		base.depends_on = task.depends_on;
		base.created_at = task.created_at;
		base.updated_at = task.updated_at;
	}

	for (const [key, value] of Object.entries(task.extra_frontmatter)) {
		if (!(key in base)) base[key] = value;
	}
	return base;
}

function renderSections(sections: Section[]): string {
	const parts: string[] = [];
	for (const section of sections) {
		if (section.level === 0 || section.heading === "") {
			if (section.content.length > 0) parts.push(section.content);
			continue;
		}
		const hashes = "#".repeat(section.level || 2);
		parts.push(`${hashes} ${section.heading}\n\n${section.content}`.trimEnd());
	}
	return parts.join("\n\n");
}

export function serializeTask(task: Task, mode: SchemaMode): string {
	const frontmatter = buildFrontmatter(task, mode);
	const yaml = stringifyYaml(frontmatter).trimEnd();
	const body = renderSections(task.sections);
	return `---\n${yaml}\n---\n\n${body}\n`;
}

export function defaultSectionsFor(mode: SchemaMode): Section[] {
	const headings = mode === "backlog" ? BACKLOG_BODY_HEADINGS : ORDNA_BODY_HEADINGS;
	const sections: Section[] = [];
	for (const heading of Object.values(headings)) {
		const content = heading === "Acceptance Criteria" ? "- [ ] " : "";
		sections.push({ heading, level: 2, content });
	}
	return sections;
}

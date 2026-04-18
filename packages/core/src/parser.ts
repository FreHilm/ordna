import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import {
	type AcceptanceItem,
	BODY_HEADING_ALIASES,
	FRONTMATTER_ALIASES,
	type Priority,
	type RawFrontmatter,
	type Section,
	type Task,
	frontmatterSchema,
} from "./schema.js";

function pickAlias<T>(
	frontmatter: Record<string, unknown>,
	canonical: string,
): T | undefined {
	const aliases = FRONTMATTER_ALIASES[canonical] ?? [canonical];
	for (const key of aliases) {
		if (key in frontmatter && frontmatter[key] !== undefined && frontmatter[key] !== null) {
			return frontmatter[key] as T;
		}
	}
	return undefined;
}

function normalizeDate(value: unknown): string {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === "string") return value;
	return "";
}

function normalizeAssignee(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return value.length === 0 ? null : value;
	if (Array.isArray(value)) {
		const first = value.find((v) => typeof v === "string" && v.length > 0);
		return (first as string | undefined) ?? null;
	}
	return null;
}

function normalizePriority(value: unknown): Priority | null {
	if (value === "high" || value === "medium" || value === "low") return value;
	return null;
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === "string");
}

export function splitSections(body: string): Section[] {
	const lines = body.split("\n");
	const sections: Section[] = [];
	let current: Section | null = null;
	let preamble = "";
	let sawHeading = false;

	for (const line of lines) {
		const match = line.match(/^(#{2})\s+(.+?)\s*$/);
		if (match) {
			if (current) sections.push(finalizeSection(current));
			current = { heading: match[2] as string, level: 2, content: "" };
			sawHeading = true;
			continue;
		}
		if (!sawHeading) {
			preamble += (preamble ? "\n" : "") + line;
		} else if (current) {
			current.content += (current.content ? "\n" : "") + line;
		}
	}
	if (current) sections.push(finalizeSection(current));

	const trimmedPreamble = preamble.replace(/^\n+|\n+$/g, "");
	if (trimmedPreamble.length > 0) {
		sections.unshift({ heading: "", level: 0, content: trimmedPreamble });
	}
	return sections;
}

function finalizeSection(section: Section): Section {
	return { ...section, content: section.content.replace(/^\n+|\n+$/g, "") };
}

export function findSection(sections: Section[], canonical: string): Section | undefined {
	const aliases = BODY_HEADING_ALIASES[canonical] ?? [canonical];
	return sections.find((s) => aliases.some((a) => a.toLowerCase() === s.heading.toLowerCase()));
}

export function extractAcceptanceCriteria(sections: Section[]): AcceptanceItem[] {
	const section = findSection(sections, "acceptance_criteria");
	if (!section) return [];
	const items: AcceptanceItem[] = [];
	for (const line of section.content.split("\n")) {
		const m = line.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
		if (m) items.push({ checked: m[1] !== " ", text: (m[2] ?? "").trim() });
	}
	return items;
}

function collectExtraFrontmatter(frontmatter: RawFrontmatter): Record<string, unknown> {
	const known = new Set<string>();
	for (const aliases of Object.values(FRONTMATTER_ALIASES)) {
		for (const key of aliases) known.add(key);
	}
	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!known.has(key)) extra[key] = value;
	}
	return extra;
}

export function parseTask(raw: string, filePath: string): Task {
	const parsed = matter(raw);
	const frontmatter = frontmatterSchema.parse(parsed.data ?? {});
	const sections = splitSections(parsed.content);

	return {
		id: String(frontmatter.id),
		title: String(frontmatter.title),
		status: String(frontmatter.status),
		assignee: normalizeAssignee(pickAlias(frontmatter, "assignee")),
		priority: normalizePriority(pickAlias(frontmatter, "priority")),
		tags: normalizeStringArray(pickAlias(frontmatter, "tags")),
		depends_on: normalizeStringArray(pickAlias(frontmatter, "depends_on")),
		created_at: normalizeDate(pickAlias(frontmatter, "created_at")),
		updated_at: normalizeDate(pickAlias(frontmatter, "updated_at")),
		sections,
		extra_frontmatter: collectExtraFrontmatter(frontmatter),
		filePath,
		rawContent: raw,
	};
}

export async function parseTaskFile(filePath: string): Promise<Task> {
	const raw = await readFile(filePath, "utf8");
	return parseTask(raw, filePath);
}

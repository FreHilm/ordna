import type {
	OrdnaConfig,
	Priority,
	Section,
	Task,
	TaskRemote,
} from "@frehilm/ordna-core";
import { adfToMarkdown } from "./adf.js";
import type {
	JiraAdfNode,
	JiraIssue,
	JiraIssueLink,
	JiraSprintCustomField,
} from "./schema.js";

/**
 * The set of custom field IDs the plugin discovered at init time. All
 * are optional — if the Jira instance doesn't have a Story Points
 * field, for example, we just skip that piece of metadata.
 */
export interface CustomFieldMap {
	sprint?: string;
	storyPoints?: string;
	epic?: string;
}

export interface MapContext {
	config: OrdnaConfig;
	baseUrl: string;
	customFields: CustomFieldMap;
}

/**
 * Turn a Jira issue into an Ordna Task. Pure: same input, same output;
 * no I/O. The reverse mapping (Task → Jira fields) lives in the write
 * milestone follow-up; that's why this is a one-way function for now.
 */
export function issueToTask(issue: JiraIssue, ctx: MapContext): Task {
	const fields = issue.fields;

	const id = jiraKeyToOrdnaId(issue.key, ctx.config);
	const title = fields.summary ?? "(no summary)";
	const status = (fields.status?.name ?? "todo").toLowerCase();
	const assignee = fields.assignee?.displayName ?? null;
	const priority = mapPriority(fields.priority?.name);
	const tags = fields.labels ?? [];
	const depends_on = extractBlockedBy(fields.issuelinks ?? []).map((key) =>
		jiraKeyToOrdnaId(key, ctx.config),
	);

	const created_at = isoDateOnly(fields.created);
	const updated_at = isoDateOnly(fields.updated);

	const sections = descriptionToSections(fields.description);

	const remote: TaskRemote = {
		provider: "jira",
		externalId: issue.key,
		url: `${ctx.baseUrl.replace(/\/+$/, "")}/browse/${issue.key}`,
		extras: buildExtras(fields, ctx.customFields),
	};

	return {
		id,
		title,
		status,
		assignee,
		priority,
		tags,
		depends_on,
		created_at,
		updated_at,
		sections,
		extra_frontmatter: {},
		remote,
	};
}

/**
 * Convert `ENG-123` to `T-123` when `idPrefix: T`, or leave the Jira key
 * verbatim otherwise. The numeric tail is reformatted with the
 * configured zero-padding so IDs sort consistently with file-mode tasks.
 */
export function jiraKeyToOrdnaId(key: string, config: OrdnaConfig): string {
	const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(key);
	if (!m) return key; // Not a standard Jira key; fall through.
	const [, , numStr] = m;
	if (!numStr) return key;
	const n = Number(numStr);
	if (!Number.isFinite(n)) return key;
	const padded = String(n).padStart(config.zeroPaddedIds, "0");
	return `${config.idPrefix}-${padded}`;
}

/**
 * Reverse: turn an Ordna id (`T-123`) into the Jira key (`ENG-123`)
 * by re-attaching the project key. Only meaningful when we know which
 * project the id originated from; we trust the caller to pass it.
 */
export function ordnaIdToJiraKey(
	id: string,
	projectKey: string,
	config: OrdnaConfig,
): string {
	const prefix = `${config.idPrefix}-`;
	if (id.startsWith(prefix)) {
		const tail = id.slice(prefix.length);
		const n = Number(tail);
		if (Number.isFinite(n)) return `${projectKey}-${n}`;
	}
	// Looks like it's already a Jira key.
	return id;
}

function mapPriority(name: string | undefined): Priority | null {
	if (!name) return null;
	const norm = name.trim().toLowerCase();
	// Jira priority scale (default): Highest, High, Medium, Low, Lowest.
	if (norm === "highest" || norm === "high") return "high";
	if (norm === "medium") return "medium";
	if (norm === "low" || norm === "lowest") return "low";
	return null;
}

function extractBlockedBy(links: JiraIssueLink[]): string[] {
	const out: string[] = [];
	for (const link of links) {
		const typeName = (link.type?.name ?? "").toLowerCase();
		// An "is blocked by" relationship appears as a link of type
		// "Blocks" with the *current* issue on the inward side.
		if (typeName !== "blocks") continue;
		if (link.inwardIssue?.key) out.push(link.inwardIssue.key);
	}
	return out;
}

function isoDateOnly(value: unknown): string {
	if (typeof value !== "string") return "";
	// Jira returns ISO 8601 with millis + offset, e.g.
	// "2026-04-25T08:12:31.000+0200". The first 10 chars are the date.
	return value.slice(0, 10);
}

function descriptionToSections(adf: JiraAdfNode | null): Section[] {
	if (!adf) return [];
	const markdown = adfToMarkdown(adf);
	if (!markdown) return [];
	return [
		{
			heading: "Description",
			level: 2,
			content: markdown,
		},
	];
}

function buildExtras(
	fields: JiraIssue["fields"],
	map: CustomFieldMap,
): Record<string, unknown> {
	const extras: Record<string, unknown> = {};
	if (map.sprint) {
		const raw = fields[map.sprint];
		const active = pickActiveSprint(raw);
		if (active) extras.sprint = active;
	}
	if (map.storyPoints) {
		const raw = fields[map.storyPoints];
		if (typeof raw === "number") extras.storyPoints = raw;
	}
	if (map.epic) {
		const raw = fields[map.epic];
		if (typeof raw === "string" && raw.length > 0) extras.epic = raw;
	}
	return extras;
}

function pickActiveSprint(raw: unknown): string | null {
	// Sprint custom field comes as an array of sprint objects (REST v3)
	// or sometimes as the older toString-of-Java-object format. We
	// handle the modern shape and fall back to extracting `name=` from
	// the legacy string as a defensive last resort.
	if (Array.isArray(raw)) {
		const sprints = raw as JiraSprintCustomField[];
		const active = sprints.find((s) => s?.state === "active");
		const pick = active ?? sprints[sprints.length - 1];
		return pick?.name ?? null;
	}
	if (typeof raw === "string") {
		const m = /name=([^,\]]+)/.exec(raw);
		return m?.[1] ?? null;
	}
	return null;
}

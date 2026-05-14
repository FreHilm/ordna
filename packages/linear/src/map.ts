import type {
	OrdnaConfig,
	Priority,
	Section,
	Task,
	TaskRemote,
} from "@frehilm/ordna-core";
import type { LinearIssue } from "./schema.js";

export interface MapContext {
	config: OrdnaConfig;
	teamId: string;
}

/**
 * Pure mapping: Linear issue → Ordna Task. No I/O. Mirrors the shape of
 * `packages/jira/src/map.ts:issueToTask` so the two plugins look
 * structurally identical to anyone reading the code.
 *
 * Description handling is much simpler than Jira's: Linear stores
 * markdown natively, so we wrap it in a single `## Description`
 * section without translation.
 */
export function issueToTask(issue: LinearIssue, ctx: MapContext): Task {
	const id = linearIdentifierToOrdnaId(issue.identifier, ctx.config);

	const status = (issue.state.name ?? "todo").toLowerCase();
	const assignee = issue.assignee?.displayName ?? null;
	const priority = mapPriority(issue.priority);
	const tags = issue.labels.nodes.map((l) => l.name);

	const depends_on = issue.relations.nodes
		.filter((r) => r.type === "blocks" && r.relatedIssue != null)
		.map((r) =>
			linearIdentifierToOrdnaId(r.relatedIssue?.identifier ?? "", ctx.config),
		);

	const created_at = isoDateOnly(issue.createdAt);
	const updated_at = isoDateOnly(issue.updatedAt);

	const sections: Section[] =
		issue.description && issue.description.trim().length > 0
			? [{ heading: "Description", level: 2, content: issue.description }]
			: [];

	const extras: Record<string, unknown> = {};
	if (issue.cycle) extras.cycle = issue.cycle.name;
	if (issue.project) extras.project = issue.project.name;
	if (issue.parent) extras.parentIssue = issue.parent.identifier;

	const remote: TaskRemote = {
		provider: "linear",
		externalId: issue.identifier,
		url: issue.url,
		extras,
	};

	return {
		id,
		title: issue.title,
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
 * Linear identifiers look like `ENG-42` — same shape as Jira keys.
 * This function is a near-duplicate of `jiraKeyToOrdnaId` from the
 * Jira plugin. We're deliberately not sharing it: the conceptual
 * meaning differs per tracker, and copying ~10 LOC keeps the packages
 * fully decoupled.
 */
export function linearIdentifierToOrdnaId(
	identifier: string,
	config: OrdnaConfig,
): string {
	const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(identifier);
	if (!m) return identifier;
	const [, , numStr] = m;
	if (!numStr) return identifier;
	const n = Number(numStr);
	if (!Number.isFinite(n)) return identifier;
	const padded = String(n).padStart(config.zeroPaddedIds, "0");
	return `${config.idPrefix}-${padded}`;
}

/**
 * Reverse: turn an Ordna id (`T-42`) into the Linear identifier
 * (`ENG-42`) by re-attaching the team's identifier prefix. The
 * caller must know the team's prefix (Linear teams have one; we
 * look it up in `init()` and pass it down here).
 */
export function ordnaIdToLinearIdentifier(
	id: string,
	teamIdentifierPrefix: string,
	config: OrdnaConfig,
): string {
	const prefix = `${config.idPrefix}-`;
	if (id.startsWith(prefix)) {
		const tail = id.slice(prefix.length);
		const n = Number(tail);
		if (Number.isFinite(n)) return `${teamIdentifierPrefix}-${n}`;
	}
	return id;
}

function mapPriority(p: number): Priority | null {
	// Linear's scale: 0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low.
	// Collapse urgent into high — Ordna only has three levels.
	if (p === 1 || p === 2) return "high";
	if (p === 3) return "medium";
	if (p === 4) return "low";
	return null;
}

function isoDateOnly(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.slice(0, 10);
}

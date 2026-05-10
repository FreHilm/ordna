/**
 * Narrow TypeScript types for the slice of Jira's REST v3 responses we
 * actually consume. Fields we don't read are intentionally omitted to
 * keep the surface small and the mapping testable.
 */

export interface JiraSearchResponse {
	issues: JiraIssue[];
	total: number;
	startAt: number;
	maxResults: number;
}

export interface JiraIssue {
	key: string;
	self?: string;
	fields: JiraIssueFields;
}

export interface JiraIssueFields {
	summary: string;
	description: JiraAdfNode | null;
	status: { name: string; statusCategory?: { key?: string } };
	assignee: { displayName: string; accountId?: string } | null;
	priority: { name: string } | null;
	labels: string[];
	issuelinks: JiraIssueLink[];
	created: string;
	updated: string;
	// Custom fields land here too (e.g. customfield_10020 for Sprint).
	// We index them via the discovered IDs in JiraTaskProvider.
	[key: string]: unknown;
}

export interface JiraIssueLink {
	id?: string;
	type: { name: string; inward?: string; outward?: string };
	inwardIssue?: { key: string };
	outwardIssue?: { key: string };
}

export interface JiraFieldDefinition {
	id: string;
	key?: string;
	name: string;
	custom?: boolean;
	schema?: { type?: string; custom?: string };
}

/**
 * Atlassian Document Format — the structured representation Jira uses for
 * rich text fields like `description`. Recursive: a `doc` contains
 * blocks, blocks contain inlines, inlines may carry marks.
 *
 * The full spec is large; this type covers the nodes the converter
 * recognises. Unknown nodes are tolerated at runtime.
 */
export interface JiraAdfNode {
	type: string;
	content?: JiraAdfNode[];
	text?: string;
	marks?: JiraAdfMark[];
	attrs?: Record<string, unknown>;
}

export interface JiraAdfMark {
	type: string;
	attrs?: Record<string, unknown>;
}

export interface JiraProjectStatusesResponse {
	// Returned by GET /rest/api/3/project/{key}/statuses — array of issue
	// types, each carrying its own ordered status list.
	id: string;
	name: string;
	statuses: { name: string; statusCategory?: { key?: string } }[];
}

export interface JiraSprintCustomField {
	id: number;
	name: string;
	state: "active" | "closed" | "future";
	// ... other fields ignored
}

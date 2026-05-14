/**
 * Narrow TypeScript types for the slice of Linear's GraphQL responses
 * we consume. Linear's full schema is huge; we only model the fields
 * mapped into `Task`.
 */

export interface LinearGraphQLResponse<T> {
	data?: T;
	errors?: LinearGraphQLError[];
}

export interface LinearGraphQLError {
	message: string;
	extensions?: { code?: string; type?: string };
	path?: (string | number)[];
}

export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	priority: number; // 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low
	url: string;
	createdAt: string;
	updatedAt: string;
	state: { id: string; name: string; type: string };
	assignee: { id: string; displayName: string } | null;
	labels: { nodes: { id: string; name: string }[] };
	relations: {
		nodes: {
			type: string;
			relatedIssue: { identifier: string } | null;
		}[];
	};
	cycle: { id: string; name: string } | null;
	project: { id: string; name: string } | null;
	parent: { identifier: string } | null;
}

export interface LinearIssuesResponse {
	issues: {
		nodes: LinearIssue[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

export interface LinearIssueResponse {
	issue: LinearIssue | null;
}

export interface LinearWorkflowState {
	id: string;
	name: string;
	position: number;
	type: string;
}

export interface LinearTeamStatesResponse {
	team: {
		id: string;
		states: { nodes: LinearWorkflowState[] };
	} | null;
}

export interface LinearViewerResponse {
	viewer: { id: string; name: string; email: string };
}

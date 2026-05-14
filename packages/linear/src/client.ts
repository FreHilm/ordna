import type {
	LinearGraphQLResponse,
	LinearIssue,
	LinearIssueResponse,
	LinearIssuesResponse,
	LinearTeamStatesResponse,
	LinearWorkflowState,
} from "./schema.js";

export interface LinearClientOptions {
	apiKey: string;
	/**
	 * Override the GraphQL endpoint. Defaults to Linear's production
	 * URL; tests pass a stubbed `http://127.0.0.1:<port>/graphql`.
	 */
	endpoint?: string;
	fetch?: typeof fetch;
}

const DEFAULT_ENDPOINT = "https://api.linear.app/graphql";

/**
 * Minimal Linear GraphQL client. One POST per query. Auth header is
 * the bare API key (no "Bearer" prefix — Linear's convention).
 *
 * Rate limits: Linear surfaces them as HTTP 429 with `Retry-After`,
 * same as Jira. We honour the header and back off; up to 3 retries.
 */
export class LinearClient {
	readonly endpoint: string;
	private readonly apiKey: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: LinearClientOptions) {
		this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
		this.apiKey = options.apiKey;
		this.fetchImpl = options.fetch ?? fetch;
	}

	async listIssues(filter: {
		teamId: string;
		extraFilter?: string;
	}): Promise<LinearIssue[]> {
		// Paginated list. Linear returns up to 50 by default; we ask for
		// 100 and follow `pageInfo.endCursor` until exhausted.
		const issues: LinearIssue[] = [];
		let after: string | null = null;
		const PAGE = 100;

		// Linear's IssueFilter is a nested object literal, not a string.
		// We always filter by team; the `extraFilter` is reserved for a
		// future enhancement (a parsed filter DSL → IssueFilter object).
		while (true) {
			const variables: Record<string, unknown> = {
				teamId: filter.teamId,
				first: PAGE,
			};
			if (after) variables.after = after;
			const data = await this.query<LinearIssuesResponse>(
				LIST_ISSUES_QUERY,
				variables,
			);
			const nodes = data.issues.nodes;
			issues.push(...nodes);
			if (!data.issues.pageInfo.hasNextPage) break;
			after = data.issues.pageInfo.endCursor;
			if (!after) break;
		}
		return issues;
	}

	async getIssueByIdentifier(identifier: string): Promise<LinearIssue | null> {
		const data = await this.query<LinearIssueResponse>(
			GET_ISSUE_QUERY,
			{ id: identifier },
		);
		return data.issue;
	}

	async listTeamStates(teamId: string): Promise<LinearWorkflowState[]> {
		const data = await this.query<LinearTeamStatesResponse>(
			TEAM_STATES_QUERY,
			{ teamId },
		);
		return data.team?.states.nodes ?? [];
	}

	async query<T>(
		query: string,
		variables: Record<string, unknown> = {},
	): Promise<T> {
		const MAX_RETRIES = 3;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const res = await this.fetchImpl(this.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: this.apiKey,
				},
				body: JSON.stringify({ query, variables }),
			});

			if (res.status === 429 && attempt < MAX_RETRIES) {
				const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
				await sleep(retryAfter ?? backoffMs(attempt));
				continue;
			}
			if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES) {
				await sleep(backoffMs(attempt));
				continue;
			}

			if (!res.ok) {
				const body = await safeReadBody(res);
				lastError = new Error(
					`Linear ${res.status} ${res.statusText}: ${body}`,
				);
				throw lastError;
			}

			const payload = (await res.json()) as LinearGraphQLResponse<T>;
			if (payload.errors && payload.errors.length > 0) {
				// GraphQL errors come back with status 200 but the payload
				// carries an `errors` array. Surface every message.
				const message = payload.errors.map((e) => e.message).join("; ");
				throw new Error(`Linear GraphQL error: ${message}`);
			}
			if (!payload.data) {
				throw new Error("Linear GraphQL: response missing `data` field");
			}
			return payload.data;
		}
		throw lastError ?? new Error("Linear query failed");
	}
}

// ---------- GraphQL document strings ----------

const ISSUE_FRAGMENT = `
  id
  identifier
  title
  description
  priority
  url
  createdAt
  updatedAt
  state { id name type }
  assignee { id displayName }
  labels { nodes { id name } }
  relations { nodes { type relatedIssue { identifier } } }
  cycle { id name }
  project { id name }
  parent { identifier }
`;

const LIST_ISSUES_QUERY = `
  query Issues($teamId: ID!, $first: Int!, $after: String) {
    issues(
      filter: { team: { id: { eq: $teamId } } },
      first: $first,
      after: $after,
      orderBy: createdAt
    ) {
      nodes { ${ISSUE_FRAGMENT} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query Issue($id: String!) {
    issue(id: $id) { ${ISSUE_FRAGMENT} }
  }
`;

const TEAM_STATES_QUERY = `
  query TeamStates($teamId: String!) {
    team(id: $teamId) {
      id
      states { nodes { id name position type } }
    }
  }
`;

/**
 * Public so the subscription module can use the same fragment for its
 * subscription query without re-declaring the field list.
 */
export const ISSUE_FIELDS_FRAGMENT = ISSUE_FRAGMENT;

// ---------- helpers ----------

function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	const asNumber = Number(header);
	if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber * 1000;
	const asDate = Date.parse(header);
	if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
	return null;
}

function backoffMs(attempt: number): number {
	const base = 1000 * 2 ** attempt;
	const jitter = base * 0.25 * (Math.random() * 2 - 1);
	return Math.max(0, Math.floor(base + jitter));
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function safeReadBody(res: Response): Promise<string> {
	try {
		const text = await res.text();
		if (!text) return "(empty body)";
		try {
			const parsed = JSON.parse(text) as { errors?: { message: string }[] };
			if (parsed.errors?.length) {
				return parsed.errors.map((e) => e.message).join("; ");
			}
		} catch {
			// fall through
		}
		return text.length > 500 ? `${text.slice(0, 500)}…` : text;
	} catch {
		return "(unreadable body)";
	}
}

import type {
	JiraFieldDefinition,
	JiraIssue,
	JiraProjectStatusesResponse,
	JiraSearchResponse,
} from "./schema.js";

export interface JiraClientOptions {
	baseUrl: string;
	email: string;
	apiToken: string;
	/**
	 * Override for tests. When set, all requests target this base URL
	 * instead of the public Atlassian endpoint.
	 */
	fetch?: typeof fetch;
}

/**
 * Thin HTTP client for the Jira REST v3 API.
 *
 * - Auth: HTTP Basic with `email:apiToken` (Jira Cloud's standard).
 * - Rate limits: honours `Retry-After` on 429; exponential backoff on
 *   transient 5xx (up to 3 retries with jitter).
 * - Errors: throws with Jira's error message body verbatim so workflow-
 *   rejection messages ("Transition is not valid") surface to the user
 *   without translation.
 */
export class JiraClient {
	private readonly baseUrl: string;
	private readonly authHeader: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: JiraClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		const credentials = Buffer.from(
			`${options.email}:${options.apiToken}`,
			"utf8",
		).toString("base64");
		this.authHeader = `Basic ${credentials}`;
		this.fetchImpl = options.fetch ?? fetch;
	}

	async searchIssues(jql: string, fields: string[]): Promise<JiraIssue[]> {
		// Pagination: JQL search returns up to 100 issues per page by
		// default. We loop until the server signals it's done.
		const issues: JiraIssue[] = [];
		const pageSize = 100;
		let startAt = 0;
		while (true) {
			const body = JSON.stringify({
				jql,
				fields,
				startAt,
				maxResults: pageSize,
			});
			const res = (await this.request("/rest/api/3/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			})) as JiraSearchResponse;
			issues.push(...res.issues);
			if (
				res.issues.length === 0 ||
				startAt + res.issues.length >= res.total
			) {
				break;
			}
			startAt += res.issues.length;
		}
		return issues;
	}

	async getIssue(key: string, fields: string[]): Promise<JiraIssue> {
		const params = new URLSearchParams({ fields: fields.join(",") });
		return this.request<JiraIssue>(
			`/rest/api/3/issue/${encodeURIComponent(key)}?${params.toString()}`,
		);
	}

	async listFields(): Promise<JiraFieldDefinition[]> {
		return this.request<JiraFieldDefinition[]>("/rest/api/3/field");
	}

	async listProjectStatuses(
		projectKey: string,
	): Promise<JiraProjectStatusesResponse[]> {
		return this.request<JiraProjectStatusesResponse[]>(
			`/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
		);
	}

	/**
	 * Single low-level request entry point. All public methods go through
	 * here so retry / rate-limit policy is centralised.
	 */
	private async request<T>(
		path: string,
		init: RequestInit = {},
	): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers = new Headers(init.headers);
		headers.set("Authorization", this.authHeader);
		headers.set("Accept", "application/json");

		const MAX_RETRIES = 3;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const res = await this.fetchImpl(url, { ...init, headers });

			if (res.ok) {
				const ct = res.headers.get("content-type") ?? "";
				if (ct.includes("application/json")) {
					return (await res.json()) as T;
				}
				return (await res.text()) as unknown as T;
			}

			// 429: rate limit. Honour Retry-After (seconds or HTTP-date).
			if (res.status === 429 && attempt < MAX_RETRIES) {
				const retryAfter = res.headers.get("retry-after");
				const delayMs = parseRetryAfter(retryAfter) ?? backoffMs(attempt);
				await sleep(delayMs);
				continue;
			}

			// 5xx: transient. Backoff and retry.
			if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES) {
				await sleep(backoffMs(attempt));
				continue;
			}

			// Anything else (4xx other than 429, or exhausted retries): throw
			// with Jira's error body so workflow-rejection messages survive.
			const errBody = await safeReadErrorBody(res);
			lastError = new Error(
				`Jira ${res.status} ${res.statusText} on ${init.method ?? "GET"} ${path}: ${errBody}`,
			);
			throw lastError;
		}

		throw lastError ?? new Error(`Jira request failed: ${path}`);
	}
}

function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	const asNumber = Number(header);
	if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber * 1000;
	const asDate = Date.parse(header);
	if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
	return null;
}

function backoffMs(attempt: number): number {
	// 1s, 2s, 4s with up to ±25% jitter.
	const base = 1000 * 2 ** attempt;
	const jitter = base * 0.25 * (Math.random() * 2 - 1);
	return Math.max(0, Math.floor(base + jitter));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadErrorBody(res: Response): Promise<string> {
	try {
		const text = await res.text();
		if (!text) return "(empty body)";
		// Jira error payloads often look like:
		// { "errorMessages": ["..."], "errors": { "field": "..." } }
		try {
			const parsed = JSON.parse(text) as {
				errorMessages?: string[];
				errors?: Record<string, string>;
			};
			const parts: string[] = [];
			if (parsed.errorMessages?.length) parts.push(...parsed.errorMessages);
			if (parsed.errors) {
				for (const [field, message] of Object.entries(parsed.errors)) {
					parts.push(`${field}: ${message}`);
				}
			}
			if (parts.length > 0) return parts.join("; ");
		} catch {
			// Fall through to raw text.
		}
		return text.length > 500 ? `${text.slice(0, 500)}…` : text;
	} catch {
		return "(unreadable body)";
	}
}

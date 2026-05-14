import { type Client, createClient } from "graphql-ws";
import WebSocket from "ws";
import { ISSUE_FIELDS_FRAGMENT } from "./client.js";
import type { LinearIssue } from "./schema.js";

const DEFAULT_WS_ENDPOINT = "wss://api.linear.app/graphql";

export interface SubscriptionOptions {
	apiKey: string;
	teamId: string;
	wsEndpoint?: string;
	/**
	 * Override for tests. `graphql-ws` needs a WebSocket implementation
	 * because Node 20 doesn't ship one in the global scope yet.
	 */
	webSocketImpl?: typeof WebSocket;
}

export interface SubscriptionHandle {
	close: () => Promise<void>;
}

/**
 * GraphQL subscription wrapper. Linear's public API doesn't officially
 * document WebSocket subscriptions, so this is a speculative path:
 * if the endpoint accepts a `graphql-ws` connection AND returns issue
 * events for our subscription document, we use it; if anything fails
 * — handshake, payload shape, runtime error — the provider falls back
 * to the polling loop.
 *
 * The contract for callers: pass an `onIssue` callback that runs on
 * every payload. We don't classify events here (added vs changed); the
 * provider's diff layer handles that.
 */
export function subscribeToIssues(
	options: SubscriptionOptions,
	onIssue: (issue: LinearIssue) => void,
	onError: (err: Error) => void,
): Promise<SubscriptionHandle> {
	const wsEndpoint = options.wsEndpoint ?? DEFAULT_WS_ENDPOINT;
	const WSImpl = options.webSocketImpl ?? WebSocket;

	const client: Client = createClient({
		url: wsEndpoint,
		webSocketImpl: WSImpl,
		connectionParams: {
			Authorization: options.apiKey,
		},
		// Quick fail on connect — if Linear doesn't speak this protocol,
		// we want to know fast so polling can take over.
		connectionAckWaitTimeout: 5000,
		retryAttempts: 0,
	});

	const query = `
		subscription IssueEvents($teamId: ID!) {
			issueUpdated(teamId: $teamId) { ${ISSUE_FIELDS_FRAGMENT} }
		}
	`;

	return new Promise<SubscriptionHandle>((resolve, reject) => {
		let resolved = false;
		let unsubscribe: (() => void) | null = null;

		// `subscribe` returns a cleanup function. We resolve the outer
		// promise on the first successful `next` (or after the
		// connection-ack timeout if no event has arrived yet — but we
		// don't have an explicit ack hook from graphql-ws, so we lean on
		// the connect_ack timeout to surface errors quickly).
		const cleanup = client.subscribe<{ issueUpdated: LinearIssue }>(
			{ query, variables: { teamId: options.teamId } },
			{
				next: (payload) => {
					if (!resolved) {
						resolved = true;
						resolve({
							close: async () => {
								unsubscribe?.();
								await client.dispose();
							},
						});
					}
					const issue = payload.data?.issueUpdated;
					if (issue) onIssue(issue);
				},
				error: (err) => {
					const message =
						err instanceof Error
							? err.message
							: typeof err === "object"
								? JSON.stringify(err)
								: String(err);
					if (!resolved) {
						resolved = true;
						reject(new Error(`subscription failed: ${message}`));
					} else {
						onError(new Error(`subscription error: ${message}`));
					}
				},
				complete: () => {
					/* server-side complete — provider will trigger a fallback */
				},
			},
		);
		unsubscribe = cleanup;

		// If the server never sends a `next` event (which is the common
		// case for issue subscriptions that wait for activity), we still
		// want to consider the subscription "established" once the
		// connection is up. graphql-ws doesn't expose a clean
		// connection-established hook on the client, so we use a short
		// timeout: if no error has been raised by then, assume connected.
		setTimeout(() => {
			if (!resolved) {
				resolved = true;
				resolve({
					close: async () => {
						unsubscribe?.();
						await client.dispose();
					},
				});
			}
		}, 1000);
	});
}

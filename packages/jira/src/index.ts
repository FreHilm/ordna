import type { OrdnaConfig, TaskProvider } from "@frehilm/ordna-core";
import { JiraTaskProvider } from "./provider.js";

/**
 * Plugin entry point. Core's `loadProvider` calls this factory with the
 * resolved config and the project's cwd; we instantiate the provider and
 * hand it back.
 *
 * Errors thrown here (or during `init()`, which runs immediately after)
 * surface to the CLI command that triggered context creation — exactly
 * the UX we want for "your Jira token expired" or "the projectKey is
 * misspelled".
 */
export function createProvider(
	config: OrdnaConfig,
	cwd: string,
): TaskProvider {
	return new JiraTaskProvider(config, cwd);
}

export { JiraTaskProvider } from "./provider.js";
export { issueToTask, jiraKeyToOrdnaId, ordnaIdToJiraKey } from "./map.js";
export { adfToMarkdown } from "./adf.js";
export type {
	JiraAdfNode,
	JiraIssue,
	JiraIssueFields,
	JiraIssueLink,
} from "./schema.js";

import type { OrdnaConfig, TaskProvider } from "@frehilm/ordna-core";
import { LinearTaskProvider } from "./provider.js";

/**
 * Plugin entry point. Core's `loadProvider` calls this factory with
 * the resolved config and the project's cwd; we instantiate the
 * provider and hand it back.
 *
 * Errors thrown here or during `init()` surface to the CLI command
 * that triggered context creation.
 */
export function createProvider(
	config: OrdnaConfig,
	cwd: string,
): TaskProvider {
	return new LinearTaskProvider(config, cwd);
}

export { LinearTaskProvider } from "./provider.js";
export {
	issueToTask,
	linearIdentifierToOrdnaId,
	ordnaIdToLinearIdentifier,
} from "./map.js";
export type {
	LinearIssue,
	LinearGraphQLError,
	LinearWorkflowState,
} from "./schema.js";

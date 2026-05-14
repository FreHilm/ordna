import type { OrdnaConfig, TaskProvider } from "@frehilm/ordna-core";
import { RefTaskProvider } from "./provider.js";

/**
 * Plugin entry point. Core's `loadProvider` calls this with the
 * resolved config and the project cwd; we instantiate the provider
 * and hand it back.
 */
export function createProvider(
	config: OrdnaConfig,
	cwd: string,
): TaskProvider {
	return new RefTaskProvider(config, cwd);
}

export { RefTaskProvider } from "./provider.js";
export { GitRunner } from "./git.js";

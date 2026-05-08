import type { OrdnaConfig } from "../config.js";
import type { TaskProvider } from "../provider.js";
import { FileTaskProvider } from "./file.js";

/**
 * Plugin contract: each external provider package
 * (`@frehilm/ordna-<name>`) exports a single `createProvider` factory with
 * this signature. See `tasks/T-022.md` and the plugin docs for details.
 */
export type CreateProvider = (
	config: OrdnaConfig,
	cwd: string,
) => TaskProvider | Promise<TaskProvider>;

const PLUGIN_PACKAGE_PREFIX = "@frehilm/ordna-";

function isModuleNotFoundError(err: unknown, packageName: string): boolean {
	if (!(err instanceof Error)) return false;
	const code = (err as NodeJS.ErrnoException).code;
	// Native Node ESM / CJS resolver.
	if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
		return err.message.includes(packageName);
	}
	// Vite-node (used by Vitest) wraps unresolved imports without setting a
	// recognizable error code. Match its message shape so the loader still
	// surfaces the install hint when exercised from the test runner.
	const msg = err.message;
	if (
		msg.includes(packageName) &&
		(msg.startsWith("Failed to load url") ||
			msg.startsWith("Cannot find package") ||
			msg.startsWith("Cannot find module"))
	) {
		return true;
	}
	return false;
}

/**
 * Resolve a `TaskProvider` from `config.provider`.
 *
 * - `"file"` returns a `FileTaskProvider` built locally — zero overhead, no
 *   dynamic import.
 * - Any other value is loaded from `@frehilm/ordna-<value>` via dynamic
 *   `import()`. The package must export a `createProvider(config, cwd)`
 *   factory matching {@link CreateProvider}.
 *
 * Errors are deliberately actionable: a missing package surfaces the install
 * command; a malformed package surfaces the contract.
 */
export async function loadProvider(
	config: OrdnaConfig,
	cwd: string,
): Promise<TaskProvider> {
	const name = config.provider;

	if (name === "file") {
		return new FileTaskProvider(cwd, config);
	}

	const packageName = `${PLUGIN_PACKAGE_PREFIX}${name}`;
	let mod: unknown;
	try {
		mod = await import(packageName);
	} catch (err) {
		if (isModuleNotFoundError(err, packageName)) {
			throw new Error(
				`Provider "${name}" not installed. Run: pnpm add ${packageName}`,
			);
		}
		throw err;
	}

	const factory = (mod as { createProvider?: unknown }).createProvider;
	if (typeof factory !== "function") {
		throw new Error(
			`Provider package "${packageName}" does not export a \`createProvider(config, cwd)\` factory. Every Ordna plugin must export this function — see https://github.com/FreHilm/ordna for the plugin contract.`,
		);
	}

	const provider = await (factory as CreateProvider)(config, cwd);
	return provider;
}

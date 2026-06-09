import {
	createContext,
	ensureStorageConfig,
	NeedsModeSelection,
	type StoreContext,
	writeStorageConfig,
} from "@frehilm/ordna-core";
import { c } from "../colors.js";
import { promptStorageMode } from "./prompt-mode.js";

/**
 * Wrap `createContext` with the auto-detect + prompt flow used by
 * every one-shot CLI command. Handles three cases:
 *
 * 1. **Storage already known** (config file present OR `ORDNA_STORAGE`
 *    env var set OR detection lands on a confident mode) — runs as
 *    today, no interaction.
 * 2. **`NeedsModeSelection` + TTY** — prompt the user 1/2/3, write
 *    the chosen config, retry.
 * 3. **`NeedsModeSelection` + non-TTY** — print a clear error pointing
 *    at `ordna init` and the `ORDNA_STORAGE` env var, then exit with
 *    code 1.
 *
 * Returns the constructed `StoreContext` on success, or never returns
 * when it exits the process on the non-TTY path.
 */
export async function ensureContextOrExit(): Promise<StoreContext> {
	try {
		await ensureStorageConfig(process.cwd());
		return createContext();
	} catch (err) {
		if (!(err instanceof NeedsModeSelection)) throw err;
		if (process.stdin.isTTY) {
			const mode = await promptStorageMode();
			writeStorageConfig(process.cwd(), mode);
			return createContext();
		}
		// Non-TTY: be explicit about how to recover.
		console.error(
			c.red(
				"No .ordna/config.yaml found and this isn't an interactive shell.",
			),
		);
		console.error(
			c.dim(
				"  Run `ordna init` from a terminal, or set ORDNA_STORAGE=file|hybrid|namespace to skip the prompt.",
			),
		);
		process.exit(1);
	}
}

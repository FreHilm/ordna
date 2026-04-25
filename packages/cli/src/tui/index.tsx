import { render } from "ink";
import React from "react";
import type { AgentHookConfig } from "../agent.js";
import { App } from "./App.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[H";
const EXIT_ALT_SCREEN = "\x1b[?1049l";

export interface RunBoardOptions {
	/**
	 * Programmatic agent hook config. Overrides ORDNA_AGENT_HOOK_* env vars.
	 * Pass `null` to disable the hook explicitly even if env vars are set.
	 */
	agentHook?: AgentHookConfig | null;
}

export async function runBoard(options: RunBoardOptions = {}): Promise<void> {
	const useAltScreen = process.stdout.isTTY;
	if (useAltScreen) process.stdout.write(ENTER_ALT_SCREEN);

	const cleanup = (): void => {
		if (useAltScreen) process.stdout.write(EXIT_ALT_SCREEN);
	};

	const { waitUntilExit } = render(<App agentHook={options.agentHook} />, {
		exitOnCtrlC: true,
	});
	try {
		await waitUntilExit();
	} finally {
		cleanup();
	}
}

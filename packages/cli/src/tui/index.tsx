import {
	ensureStorageConfig,
	NeedsModeSelection,
	writeStorageConfig,
} from "@frehilm/ordna-core";
import { render } from "ink";
import React from "react";
import type { AgentHookConfig } from "../agent.js";
import { App } from "./App.js";
import { SetupModal } from "./SetupModal.js";

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

	try {
		// Ensure a config exists (auto-detect + optionally write) before
		// mounting the main App. If detection lands on `ask`, this
		// throws NeedsModeSelection — we render the setup modal first,
		// write the chosen config, then continue to the board.
		try {
			await ensureStorageConfig(process.cwd());
		} catch (err) {
			if (!(err instanceof NeedsModeSelection)) throw err;
			const picked = await showSetupModal(err.reason);
			if (picked === null) {
				// User cancelled — exit cleanly without rendering the board.
				return;
			}
			writeStorageConfig(process.cwd(), picked);
		}

		const { waitUntilExit } = render(
			<App agentHook={options.agentHook} />,
			{ exitOnCtrlC: true },
		);
		await waitUntilExit();
	} finally {
		cleanup();
	}
}

/**
 * Render the SetupModal in its own short-lived Ink instance, await
 * the user's choice, return the picked mode (or `null` on Esc).
 */
function showSetupModal(
	reason: string,
): Promise<"file" | "hybrid" | "namespace" | null> {
	return new Promise((resolve) => {
		let resolved = false;
		const settle = (value: "file" | "hybrid" | "namespace" | null): void => {
			if (resolved) return;
			resolved = true;
			instance.unmount();
			resolve(value);
		};
		const instance = render(
			<SetupModal
				reason={reason}
				onPick={(mode) => settle(mode)}
				onCancel={() => settle(null)}
			/>,
			{ exitOnCtrlC: true },
		);
		instance.waitUntilExit().then(() => settle(null));
	});
}

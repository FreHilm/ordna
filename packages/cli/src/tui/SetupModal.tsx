import { Box, Text, useApp, useInput } from "ink";
import React, { useState } from "react";
import { theme } from "./theme.js";

const OPTIONS = [
	{
		key: "file" as const,
		label: "file",
		blurb: "Tasks as markdown in tasks/  (default, recommended)",
	},
	{
		key: "hybrid" as const,
		label: "hybrid",
		blurb: "Tasks as files + synced ID allocator + audit log in git",
	},
	{
		key: "namespace" as const,
		label: "namespace",
		blurb: "Tasks as git refs; working tree stays clean",
	},
];

export interface SetupModalProps {
	reason: string;
	onPick: (mode: "file" | "hybrid" | "namespace") => void;
	onCancel: () => void;
}

/**
 * Ink modal shown on first launch when storage detection lands on
 * `ask` (git repo, no signals). Three options, terse blurbs, j/k or
 * ↑/↓ to navigate, Enter to pick, Esc to cancel (exits the TUI
 * without writing anything).
 */
export function SetupModal({
	reason,
	onPick,
	onCancel,
}: SetupModalProps): React.JSX.Element {
	const { exit } = useApp();
	const [index, setIndex] = useState(0);

	useInput((input, key) => {
		if (key.escape) {
			onCancel();
			exit();
			return;
		}
		if (key.upArrow || input === "k") {
			setIndex((i) => Math.max(0, i - 1));
			return;
		}
		if (key.downArrow || input === "j") {
			setIndex((i) => Math.min(OPTIONS.length - 1, i + 1));
			return;
		}
		if (input === "1") {
			setIndex(0);
			return;
		}
		if (input === "2") {
			setIndex(1);
			return;
		}
		if (input === "3") {
			setIndex(2);
			return;
		}
		if (key.return) {
			const pick = OPTIONS[index]?.key ?? "file";
			onPick(pick);
		}
	});

	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Text color={theme.accent} bold>
				Pick a storage mode for this project
			</Text>
			<Box marginTop={1}>
				<Text color={theme.textMuted} wrap="wrap">
					{reason}
				</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{OPTIONS.map((opt, i) => {
					const selected = i === index;
					return (
						<Box key={opt.key}>
							<Text color={selected ? theme.accent : theme.textMuted}>
								{selected ? "› " : "  "}
							</Text>
							<Text color={selected ? theme.text : theme.textDim} bold={selected}>
								{opt.label.padEnd(11, " ")}
							</Text>
							<Text color={theme.textMuted}>{opt.blurb}</Text>
						</Box>
					);
				})}
			</Box>
			<Box marginTop={1}>
				<Text color={theme.textFaint} italic>
					↑/↓ or 1/2/3 to pick · Enter to confirm · Esc to cancel
				</Text>
			</Box>
		</Box>
	);
}

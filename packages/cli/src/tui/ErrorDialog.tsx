import { Box, Text, useInput } from "ink";
import type React from "react";
import { theme } from "./theme.js";

interface Props {
	message: string;
	onClose: () => void;
	width: number;
}

/**
 * Modal error dialog: stays up until the user dismisses it (Enter /
 * Esc / o / space). Used for failures that carry recovery instructions
 * — e.g. "origin is unreachable" on create — which a 2.5s toast would
 * flash away before anyone can read them.
 */
export function ErrorDialog({ message, onClose, width }: Props): React.JSX.Element {
	useInput((input, key) => {
		if (key.return || key.escape || input === "o" || input === " " || input === "q") {
			onClose();
		}
	});

	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor={theme.priority.high}
			width={width}
			paddingX={2}
			paddingY={1}
		>
			<Text color={theme.priority.high} bold>
				Error
			</Text>
			<Box marginTop={1}>
				<Text wrap="wrap">{message}</Text>
			</Box>
			<Box marginTop={1}>
				<Text bold inverse>
					{" OK "}
				</Text>
				<Text color={theme.textMuted}>{"  Enter / Esc to close"}</Text>
			</Box>
		</Box>
	);
}

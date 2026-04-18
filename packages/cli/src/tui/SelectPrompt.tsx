import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import { theme } from "./theme.js";

interface Props {
	label: string;
	options: string[];
	initialIndex?: number;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export function SelectPrompt({
	label,
	options,
	initialIndex = 0,
	onSubmit,
	onCancel,
}: Props): React.JSX.Element {
	const [index, setIndex] = useState(initialIndex);

	useInput((input, key) => {
		if (key.escape) onCancel();
		else if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
		else if (key.downArrow) setIndex((i) => Math.min(options.length - 1, i + 1));
		else if (key.return) {
			const picked = options[index];
			if (picked) onSubmit(picked);
		}
	});

	return (
		<Box
			borderStyle="double"
			borderColor={theme.borderFocused}
			flexDirection="column"
			paddingX={2}
			paddingY={1}
		>
			<Text color={theme.text} bold>
				{label}
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{options.map((opt, i) => {
					const active = i === index;
					return (
						<Text
							key={opt}
							color={active ? theme.accent : theme.textDim}
							bold={active}
						>
							{active ? "› " : "  "}
							{opt}
						</Text>
					);
				})}
			</Box>
			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					↑/↓ select · Enter confirm · Esc cancel
				</Text>
			</Box>
		</Box>
	);
}

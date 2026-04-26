import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";
import { theme } from "./theme.js";

interface Props {
	label: string;
	initialValue?: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export function TextPrompt({
	label,
	initialValue = "",
	onSubmit,
	onCancel,
}: Props): React.JSX.Element {
	const [value, setValue] = useState(initialValue);

	useInput((_input, key) => {
		if (key.escape) onCancel();
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
			<Box marginTop={1}>
				<TextInput
					value={value}
					onChange={setValue}
					onSubmit={(v) => {
						if (v.trim().length === 0) onCancel();
						else onSubmit(v);
					}}
				/>
			</Box>
			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					Enter confirm · Esc cancel
				</Text>
			</Box>
		</Box>
	);
}

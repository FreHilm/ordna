import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import React, { useState } from "react";

interface Props {
	label: string;
	initialValue?: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export function TextPrompt({ label, initialValue = "", onSubmit, onCancel }: Props): React.JSX.Element {
	const [value, setValue] = useState(initialValue);

	return (
		<Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
			<Text color="cyan" bold>
				{label}
			</Text>
			<TextInput
				value={value}
				onChange={setValue}
				onSubmit={(v) => {
					if (v.trim().length === 0) onCancel();
					else onSubmit(v);
				}}
			/>
			<Text color="gray" dimColor>
				Enter to confirm · Esc to cancel
			</Text>
		</Box>
	);
}

import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

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
		<Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
			<Text color="cyan" bold>
				{label}
			</Text>
			{options.map((opt, i) => (
				<Text key={opt} color={i === index ? "cyan" : undefined} bold={i === index}>
					{i === index ? "› " : "  "}
					{opt}
				</Text>
			))}
			<Text color="gray" dimColor>
				↑/↓ to select · Enter to confirm · Esc to cancel
			</Text>
		</Box>
	);
}

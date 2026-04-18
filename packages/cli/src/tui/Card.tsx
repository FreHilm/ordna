import type { Task } from "@ordna/core";
import { Box, Text } from "ink";
import React from "react";
import { theme } from "./theme.js";

interface Props {
	task: Task;
	focused: boolean;
	selected: boolean;
}

export function Card({ task, focused, selected }: Props): React.JSX.Element {
	const borderColor = selected ? (focused ? theme.borderFocused : "white") : theme.border;
	const priorityColor = task.priority ? theme.priority[task.priority] : undefined;

	return (
		<Box
			borderStyle="round"
			borderColor={borderColor}
			flexDirection="column"
			paddingX={1}
			marginBottom={1}
		>
			<Box>
				<Text color={theme.textAccent} bold>
					{task.id}
				</Text>
				{task.priority ? (
					<Text color={priorityColor}>{`  !${task.priority}`}</Text>
				) : null}
			</Box>
			<Text wrap="truncate-end">{task.title}</Text>
			{task.assignee ? (
				<Text color="magenta" dimColor>
					@{task.assignee}
				</Text>
			) : null}
			{task.tags.length > 0 ? (
				<Text color="cyan" dimColor>
					{task.tags.map((t) => `#${t}`).join(" ")}
				</Text>
			) : null}
		</Box>
	);
}

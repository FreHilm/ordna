import type { Task } from "@ordna/core";
import { Box, Text } from "ink";
import React from "react";
import { theme } from "./theme.js";

interface Props {
	task: Task;
	focused: boolean;
	selected: boolean;
	grabbed?: boolean;
	width?: number;
}

export function Card({ task, focused, selected, grabbed, width }: Props): React.JSX.Element {
	const isActive = selected && focused;
	const marker = grabbed ? "⇄" : selected ? (focused ? "›" : "·") : " ";
	const priorityColor = task.priority ? theme.priority[task.priority] : undefined;

	return (
		<Box width={width}>
			<Text inverse={isActive || grabbed} wrap="truncate-end">
				<Text color={grabbed ? "yellow" : "gray"}>{marker} </Text>
				<Text color={grabbed ? "yellow" : theme.textAccent} bold>
					{task.id}
				</Text>
				<Text>{"  "}</Text>
				<Text>{task.title}</Text>
				{task.priority ? <Text color={priorityColor}>{`  !${task.priority.charAt(0)}`}</Text> : null}
				{task.assignee ? <Text color="magenta">{`  @${task.assignee}`}</Text> : null}
			</Text>
		</Box>
	);
}

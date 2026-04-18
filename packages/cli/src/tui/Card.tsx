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
	const marker = grabbed ? "⇄" : isActive ? "›" : " ";
	const markerColor = grabbed ? theme.grabMarker : theme.selectionMarker;
	const idColor = grabbed ? theme.grabMarker : isActive ? theme.accent : theme.textDim;
	const titleColor = grabbed || isActive ? theme.text : theme.textDim;
	const priorityColor = task.priority ? theme.priority[task.priority] : undefined;

	return (
		<Box width={width}>
			<Text wrap="truncate-end">
				<Text color={isActive || grabbed ? markerColor : theme.textMuted}>{marker} </Text>
				<Text color={idColor} bold={isActive || grabbed}>
					{task.id}
				</Text>
				<Text color={theme.textMuted}>{"  "}</Text>
				<Text color={titleColor}>{task.title}</Text>
				{task.priority ? (
					<Text color={priorityColor}>{`  !${task.priority.charAt(0)}`}</Text>
				) : null}
				{task.assignee ? (
					<Text color={theme.textMuted}>{`  @${task.assignee}`}</Text>
				) : null}
			</Text>
		</Box>
	);
}

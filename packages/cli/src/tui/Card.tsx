import { extractAcceptanceCriteria, type Task } from "@ordna/core";
import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { tagColor, theme } from "./theme.js";

interface Props {
	task: Task;
	focused: boolean;
	selected: boolean;
	grabbed?: boolean;
	width?: number;
}

const PROGRESS_BAR_CELLS = 5;

function renderProgress(done: number, total: number): string {
	if (total === 0) return "";
	const filled = Math.max(0, Math.min(PROGRESS_BAR_CELLS, Math.round((done / total) * PROGRESS_BAR_CELLS)));
	return "█".repeat(filled) + "░".repeat(PROGRESS_BAR_CELLS - filled);
}

export function Card({ task, focused, selected, grabbed, width }: Props): React.JSX.Element {
	const isActive = selected && focused;
	const marker = grabbed ? "⇄" : isActive ? "›" : " ";

	const acStats = useMemo(() => {
		const items = extractAcceptanceCriteria(task.sections);
		if (items.length === 0) return null;
		const done = items.filter((i) => i.checked).length;
		return { done, total: items.length };
	}, [task]);

	const idColor = grabbed ? theme.grabMarker : isActive ? theme.accent : theme.textDim;
	const titleColor = grabbed || isActive ? theme.text : theme.textDim;
	const priorityColor = task.priority ? theme.priority[task.priority] : undefined;
	const prioLetter = task.priority ? `!${task.priority.charAt(0)}` : null;

	return (
		<Box width={width}>
			<Text wrap="truncate-end">
				<Text color={grabbed ? theme.grabMarker : theme.selectionMarker}>{marker} </Text>
				<Text color={idColor} bold={isActive || grabbed}>
					{task.id}
				</Text>
				{prioLetter ? <Text color={priorityColor}>{`  ${prioLetter}`}</Text> : null}
				<Text color={theme.textFaint}>{"  "}</Text>
				<Text color={titleColor}>{task.title}</Text>
				{task.tags.length > 0 ? (
					<Text>
						{"  "}
						{task.tags.slice(0, 3).map((t, i) => (
							<Text key={t}>
								{i > 0 ? <Text> </Text> : null}
								<Text color={tagColor(t)}>#{t}</Text>
							</Text>
						))}
					</Text>
				) : null}
				{task.assignee ? (
					<Text color={theme.textMuted}>{`  @${task.assignee}`}</Text>
				) : null}
				{acStats ? (
					<Text>
						<Text color={theme.textFaint}>{"  "}</Text>
						<Text color={theme.accent}>
							{renderProgress(acStats.done, acStats.total)}
						</Text>
						<Text color={theme.textMuted}>
							{` ${acStats.done}/${acStats.total}`}
						</Text>
					</Text>
				) : null}
				{task.depends_on.length > 0 ? (
					<Text color={theme.textMuted}>{`  ↪${task.depends_on.length}`}</Text>
				) : null}
			</Text>
		</Box>
	);
}

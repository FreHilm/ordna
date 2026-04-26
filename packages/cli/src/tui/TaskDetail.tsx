import type { Task } from "@frehilm/ordna-core";
import { Box, Text, useInput } from "ink";
import React from "react";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	task: Task;
	onClose: () => void;
	onEdit: () => void;
	onEditExternal?: () => void;
	width: number;
	height: number;
}

export function TaskDetail({
	task,
	onClose,
	onEdit,
	onEditExternal,
	width,
	height,
}: Props): React.JSX.Element {
	useInput((input, key) => {
		if (key.escape || input === "q") onClose();
		else if (input === "e") onEdit();
		else if (input === "E" && onEditExternal) onEditExternal();
	});

	const innerWidth = Math.max(10, width - 4);

	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor={theme.borderFocused}
			width={width}
			height={height}
			paddingX={2}
			paddingY={1}
		>
			<Box>
				<Text color={theme.accent} bold>
					{task.id}
				</Text>
				<Text color={theme.textMuted}>{"  "}</Text>
				<Text color={theme.text} bold wrap="truncate-end">
					{task.title}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colorForStatus(task.status)}>{task.status}</Text>
				<Text color={theme.textMuted}>{"  ·  "}</Text>
				<Text color={theme.textDim}>
					{task.assignee ? `@${task.assignee}` : "unassigned"}
				</Text>
				{task.priority ? (
					<>
						<Text color={theme.textMuted}>{"  ·  "}</Text>
						<Text color={theme.priority[task.priority]}>{`!${task.priority}`}</Text>
					</>
				) : null}
			</Box>

			{task.tags.length > 0 ? (
				<Text color={theme.textDim}>
					{task.tags.map((t) => `#${t}`).join(" ")}
				</Text>
			) : null}
			{task.depends_on.length > 0 ? (
				<Text color={theme.textDim}>
					depends on: {task.depends_on.join(", ")}
				</Text>
			) : null}

			<Box marginTop={1} flexDirection="column" flexGrow={1}>
				{task.sections.map((section, idx) => (
					<Box
						key={`${section.heading}-${idx}`}
						flexDirection="column"
						marginBottom={1}
						width={innerWidth}
					>
						{section.heading !== "" ? (
							<Text color={theme.textDim} bold>
								{section.heading}
							</Text>
						) : null}
						{section.content.length > 0 ? (
							<Text color={theme.text} wrap="wrap">
								{section.content}
							</Text>
						) : null}
					</Box>
				))}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					{onEditExternal
						? "e edit · E $EDITOR · Esc / q close"
						: "e edit · Esc / q close"}
				</Text>
			</Box>
		</Box>
	);
}

import type { Task } from "@ordna/core";
import { Box, Text, useInput } from "ink";
import React from "react";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	task: Task;
	onClose: () => void;
	onEdit: () => void;
	width: number;
	height: number;
}

export function TaskDetail({ task, onClose, onEdit, width, height }: Props): React.JSX.Element {
	useInput((input, key) => {
		if (key.escape || input === "q") onClose();
		else if (input === "e") onEdit();
	});

	const innerWidth = Math.max(10, width - 4);

	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor="cyan"
			width={width}
			height={height}
			paddingX={2}
			paddingY={1}
		>
			<Box>
				<Text bold color="cyan">
					{task.id}
				</Text>
				<Text>{"  "}</Text>
				<Text bold wrap="truncate-end">
					{task.title}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colorForStatus(task.status)} bold>
					{task.status}
				</Text>
				<Text color={theme.textDim}>{"  ·  "}</Text>
				<Text>{task.assignee ? `@${task.assignee}` : "unassigned"}</Text>
				{task.priority ? (
					<>
						<Text color={theme.textDim}>{"  ·  "}</Text>
						<Text color={theme.priority[task.priority]}>{`!${task.priority}`}</Text>
					</>
				) : null}
			</Box>

			{task.tags.length > 0 ? (
				<Text color="cyan" dimColor>
					{task.tags.map((t) => `#${t}`).join(" ")}
				</Text>
			) : null}
			{task.depends_on.length > 0 ? (
				<Text color="blue" dimColor>
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
							<Text bold color="cyan">
								## {section.heading}
							</Text>
						) : null}
						{section.content.length > 0 ? (
							<Text wrap="wrap">{section.content}</Text>
						) : null}
					</Box>
				))}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.textDim} italic>
					e edit · Esc / q close
				</Text>
			</Box>
		</Box>
	);
}

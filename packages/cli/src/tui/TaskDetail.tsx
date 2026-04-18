import type { Task } from "@ordna/core";
import { Box, Text, useInput } from "ink";
import React from "react";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	task: Task;
	onClose: () => void;
}

export function TaskDetail({ task, onClose }: Props): React.JSX.Element {
	useInput((input, key) => {
		if (key.escape || input === "q") onClose();
	});

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
			<Box>
				<Text bold color="cyan">
					{task.id}
				</Text>
				<Text>{"  "}</Text>
				<Text bold>{task.title}</Text>
			</Box>
			<Box>
				<Text color={colorForStatus(task.status)}>{task.status}</Text>
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
			<Box marginTop={1} flexDirection="column">
				{task.sections.map((section, idx) => (
					<Box key={`${section.heading}-${idx}`} flexDirection="column" marginBottom={1}>
						{section.heading !== "" ? (
							<Text bold color="cyan">
								## {section.heading}
							</Text>
						) : null}
						{section.content.length > 0 ? <Text>{section.content}</Text> : null}
					</Box>
				))}
			</Box>
			<Text color="gray" dimColor>
				Esc / q to close
			</Text>
		</Box>
	);
}

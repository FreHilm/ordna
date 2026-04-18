import type { Task } from "@ordna/core";
import { Box, Text } from "ink";
import React from "react";
import { Card } from "./Card.js";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	status: string;
	tasks: Task[];
	focused: boolean;
	selectedIndex: number;
}

export function Column({ status, tasks, focused, selectedIndex }: Props): React.JSX.Element {
	return (
		<Box flexDirection="column" width="33%" paddingRight={1}>
			<Box marginBottom={1}>
				<Text color={colorForStatus(status)} bold>
					{status.toUpperCase()}
				</Text>
				<Text color={theme.textDim}>{`  ${tasks.length}`}</Text>
			</Box>
			{tasks.length === 0 ? (
				<Text color={theme.textDim} italic>
					(empty)
				</Text>
			) : (
				tasks.map((task, index) => (
					<Card
						key={task.id}
						task={task}
						focused={focused}
						selected={focused && index === selectedIndex}
					/>
				))
			)}
		</Box>
	);
}

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
	grabbedId: string | null;
	width: number;
	height: number;
}

export function Column({
	status,
	tasks,
	focused,
	selectedIndex,
	grabbedId,
	width,
	height,
}: Props): React.JSX.Element {
	const innerWidth = Math.max(0, width - 4);

	return (
		<Box
			flexDirection="column"
			width={width}
			height={height}
			borderStyle="double"
			borderColor={focused ? "cyan" : theme.border}
			paddingX={1}
		>
			<Box>
				<Text color={colorForStatus(status)} bold>
					{status.toUpperCase()}
				</Text>
				<Text color={theme.textDim}>{`  ${tasks.length}`}</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{tasks.length === 0 ? (
					<Text color={theme.textDim} italic>
						empty
					</Text>
				) : (
					tasks.map((task, index) => (
						<Card
							key={task.id}
							task={task}
							focused={focused}
							selected={focused && index === selectedIndex}
							grabbed={grabbedId === task.id}
							width={innerWidth}
						/>
					))
				)}
			</Box>
		</Box>
	);
}

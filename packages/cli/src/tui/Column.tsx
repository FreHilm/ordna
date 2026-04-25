import type { Task } from "@frehilm/ordna-core";
import { Box, Text } from "ink";
import React from "react";
import { Card } from "./Card.js";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	status: string;
	statusIndex: number;
	visibleTasks: Task[];
	totalTasks: number;
	aboveCount: number;
	belowCount: number;
	focused: boolean;
	selectedRelativeIndex: number;
	grabbedId: string | null;
	width: number;
	height: number;
}

export function Column({
	status,
	statusIndex,
	visibleTasks,
	totalTasks,
	aboveCount,
	belowCount,
	focused,
	selectedRelativeIndex,
	grabbedId,
	width,
	height,
}: Props): React.JSX.Element {
	const borderColor = focused ? theme.accent : theme.border;
	const statusColor = colorForStatus(status, statusIndex);
	const innerWidth = Math.max(0, width - 4);

	const titleText = status.toUpperCase();
	const countText = `(${totalTasks})`;
	const leadDashes = 2;
	const dotLabelLen = 1 + 1 + 1 + titleText.length + 1 + countText.length + 1;
	const trailDashes = Math.max(0, width - 2 - leadDashes - dotLabelLen);
	const titleLineLead = "╔" + "═".repeat(leadDashes) + " ";
	const titleLineTail = " " + "═".repeat(trailDashes) + "╗";

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Box width={width}>
				<Text color={borderColor}>{titleLineLead}</Text>
				<Text color={statusColor}>●</Text>
				<Text> </Text>
				<Text color={focused ? theme.text : theme.textDim} bold>
					{titleText}
				</Text>
				<Text color={theme.textMuted}>{` ${countText}`}</Text>
				<Text color={borderColor}>{titleLineTail}</Text>
			</Box>
			<Box
				flexDirection="column"
				width={width}
				height={Math.max(0, height - 1)}
				borderStyle="double"
				borderColor={borderColor}
				borderTop={false}
				paddingX={1}
			>
				{aboveCount > 0 ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						↑ {aboveCount} more
					</Text>
				) : null}

				{totalTasks === 0 ? (
					<Text color={theme.textFaint} italic>
						empty
					</Text>
				) : (
					visibleTasks.map((task, index) => (
						<Card
							key={task.id}
							task={task}
							focused={focused}
							selected={focused && index === selectedRelativeIndex}
							grabbed={grabbedId === task.id}
							width={innerWidth}
						/>
					))
				)}

				{belowCount > 0 ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						↓ {belowCount} more
					</Text>
				) : null}
			</Box>
		</Box>
	);
}

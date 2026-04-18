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
	const borderColor = focused ? theme.borderFocused : theme.border;
	const titleColor = focused ? theme.text : theme.textDim;
	const innerWidth = Math.max(0, width - 4);

	const titleText = status.toUpperCase();
	const countText = `(${tasks.length})`;
	const leadDashes = 2;
	const labelLen = 1 + titleText.length + 1 + countText.length + 1;
	const trailDashes = Math.max(0, width - 2 - leadDashes - labelLen);
	const titleLineLead = "╔" + "═".repeat(leadDashes) + " ";
	const titleLineTail = " " + "═".repeat(trailDashes) + "╗";

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Box width={width}>
				<Text color={borderColor}>{titleLineLead}</Text>
				<Text color={titleColor} bold={focused}>
					{titleText}
				</Text>
				<Text color={colorForStatus(status)}>{` ${countText}`}</Text>
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
				{tasks.length === 0 ? (
					<Text color={theme.textMuted} italic>
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

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

function ColumnImpl({
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

// `visibleTasks` is rebuilt with `.slice()` on every render, so default
// shallow equality would always say "different." Compare element-wise by
// (id, rawContent) — that's the parser's full-file fingerprint, so unchanged
// tasks compare equal even after a re-read from disk.
export const Column = React.memo(ColumnImpl, (prev, next) => {
	if (
		prev.status !== next.status ||
		prev.statusIndex !== next.statusIndex ||
		prev.totalTasks !== next.totalTasks ||
		prev.aboveCount !== next.aboveCount ||
		prev.belowCount !== next.belowCount ||
		prev.focused !== next.focused ||
		prev.selectedRelativeIndex !== next.selectedRelativeIndex ||
		prev.grabbedId !== next.grabbedId ||
		prev.width !== next.width ||
		prev.height !== next.height
	) {
		return false;
	}
	const a = prev.visibleTasks;
	const b = next.visibleTasks;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const ta = a[i];
		const tb = b[i];
		if (!ta || !tb) return false;
		if (ta === tb) continue;
		if (ta.id !== tb.id || ta.rawContent !== tb.rawContent) return false;
	}
	return true;
});

import type { Task } from "@frehilm/ordna-core";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	task: Task;
	onClose: () => void;
	onEdit: () => void;
	onEditExternal?: () => void;
	width: number;
	height: number;
}

type Line =
	| { kind: "heading"; text: string }
	| { kind: "content"; text: string }
	| { kind: "spacer" };

function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [text];
	const out: string[] = [];
	for (const para of text.split("\n")) {
		if (para.length === 0) {
			out.push("");
			continue;
		}
		let remaining = para;
		while (remaining.length > width) {
			let breakAt = width;
			const lastSpace = remaining.lastIndexOf(" ", width);
			if (lastSpace > Math.floor(width / 2)) breakAt = lastSpace;
			out.push(remaining.slice(0, breakAt).trimEnd());
			remaining = remaining.slice(breakAt).replace(/^ +/, "");
		}
		out.push(remaining);
	}
	return out;
}

export function TaskDetail({
	task,
	onClose,
	onEdit,
	onEditExternal,
	width,
	height,
}: Props): React.JSX.Element {
	const innerWidth = Math.max(10, width - 4);
	const hasTags = task.tags.length > 0;
	const hasDeps = task.depends_on.length > 0;

	const allLines = useMemo<Line[]>(() => {
		const out: Line[] = [];
		for (let i = 0; i < task.sections.length; i++) {
			const section = task.sections[i];
			if (!section) continue;
			if (section.heading !== "") {
				out.push({ kind: "heading", text: section.heading });
			}
			if (section.content.length > 0) {
				for (const w of wrapText(section.content, innerWidth)) {
					out.push({ kind: "content", text: w });
				}
			}
			if (i < task.sections.length - 1) {
				out.push({ kind: "spacer" });
			}
		}
		return out;
	}, [task.sections, innerWidth]);

	// Reserved layout rows inside the popup:
	//   2 border + 2 paddingY
	//   1 title row + 1 marginTop above status + 1 status row
	//   tags? + deps?
	//   1 marginTop above sections + 1 marginTop above footer + 1 footer
	const reservedRows =
		2 + 2 + 1 + 1 + 1 + (hasTags ? 1 : 0) + (hasDeps ? 1 : 0) + 1 + 1 + 1;
	const sectionsHeight = Math.max(1, height - reservedRows);

	const total = allLines.length;
	const needsScroll = total > sectionsHeight;
	const visibleCount = needsScroll
		? Math.max(1, sectionsHeight - 2)
		: sectionsHeight;
	const maxOffset = Math.max(0, total - visibleCount);

	const [scrollOffset, setScrollOffset] = useState(0);

	useEffect(() => {
		setScrollOffset(0);
	}, [task.id]);

	const offset = Math.max(0, Math.min(maxOffset, scrollOffset));
	const visibleLines = allLines.slice(offset, offset + visibleCount);
	const aboveCount = offset;
	const belowCount = Math.max(0, total - offset - visibleCount);

	useInput((input, key) => {
		if (key.escape || input === "q") {
			onClose();
			return;
		}
		if (input === "e") {
			onEdit();
			return;
		}
		if (input === "E" && onEditExternal) {
			onEditExternal();
			return;
		}
		if (key.upArrow || input === "k") {
			setScrollOffset((o) => Math.max(0, o - 1));
			return;
		}
		if (key.downArrow || input === "j") {
			setScrollOffset((o) => Math.min(maxOffset, o + 1));
			return;
		}
		if (key.pageUp) {
			setScrollOffset((o) => Math.max(0, o - visibleCount));
			return;
		}
		if (key.pageDown) {
			setScrollOffset((o) => Math.min(maxOffset, o + visibleCount));
			return;
		}
	});

	const footerHint = onEditExternal
		? "↑/↓ scroll · e edit · E $EDITOR · Esc / q close"
		: "↑/↓ scroll · e edit · Esc / q close";

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

			{task.renamed_from ? (
				<Box>
					<Text color={theme.textMuted} italic>
						previously {task.renamed_from} — auto-renumbered on push collision
					</Text>
				</Box>
			) : null}

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

			{hasTags ? (
				<Text color={theme.textDim}>
					{task.tags.map((t) => `#${t}`).join(" ")}
				</Text>
			) : null}
			{hasDeps ? (
				<Text color={theme.textDim}>
					depends on: {task.depends_on.join(", ")}
				</Text>
			) : null}

			<Box
				marginTop={1}
				flexDirection="column"
				width={innerWidth}
				height={sectionsHeight}
			>
				{needsScroll ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						{aboveCount > 0 ? `↑ ${aboveCount} more` : " "}
					</Text>
				) : null}

				{visibleLines.map((line, idx) => {
					const key = `${offset + idx}-${line.kind}`;
					if (line.kind === "heading") {
						return (
							<Text key={key} color={theme.textDim} bold wrap="truncate-end">
								{line.text}
							</Text>
						);
					}
					if (line.kind === "spacer") {
						return <Text key={key}> </Text>;
					}
					return (
						<Text key={key} color={theme.text} wrap="truncate-end">
							{line.text}
						</Text>
					);
				})}

				{needsScroll ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						{belowCount > 0 ? `↓ ${belowCount} more` : " "}
					</Text>
				) : null}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					{footerHint}
				</Text>
			</Box>
		</Box>
	);
}

import type { Attachment, Task } from "@frehilm/ordna-core";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "../lib/attachment-utils.js";
import { colorForStatus, theme } from "./theme.js";

interface Props {
	task: Task;
	canAttach?: boolean;
	onClose: () => void;
	onEdit: () => void;
	onEditExternal?: () => void;
	onAttach?: () => void;
	onOpenAttachment?: (att: Attachment) => void;
	onRemoveAttachment?: (att: Attachment) => void;
	onViewAttachment?: (att: Attachment) => void;
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
	canAttach,
	onClose,
	onEdit,
	onEditExternal,
	onAttach,
	onOpenAttachment,
	onRemoveAttachment,
	onViewAttachment,
	width,
	height,
}: Props): React.JSX.Element {
	const innerWidth = Math.max(10, width - 4);
	const hasTags = task.tags.length > 0;
	const hasDeps = task.depends_on.length > 0;
	const atts = task.attachments;
	const hasAtts = atts.length > 0;
	const [attSel, setAttSel] = useState(0);

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

	// Attachments render in a fixed window (header + up to 5 rows + an
	// optional "+N more" line) so a task with many files can't crowd out
	// the section text entirely.
	const attVisible = hasAtts ? Math.min(atts.length, 5) : 0;
	const attMore = Math.max(0, atts.length - attVisible);
	const attBlockRows = hasAtts ? 1 + 1 + attVisible + (attMore > 0 ? 1 : 0) : 0;
	let attStart = 0;
	if (attSel >= attVisible) attStart = attSel - attVisible + 1;
	attStart = Math.max(0, Math.min(attStart, Math.max(0, atts.length - attVisible)));
	const visibleAtts = atts.slice(attStart, attStart + attVisible);

	// Reserved layout rows inside the popup:
	//   2 border + 2 paddingY
	//   1 title row + 1 marginTop above status + 1 status row
	//   tags? + deps?
	//   1 marginTop above sections + attachments block + 1 marginTop + 1 footer
	const reservedRows =
		2 + 2 + 1 + 1 + 1 + (hasTags ? 1 : 0) + (hasDeps ? 1 : 0) + 1 + attBlockRows + 1 + 1;
	const sectionsHeight = Math.max(1, height - reservedRows);

	const total = allLines.length;
	const needsScroll = total > sectionsHeight;
	const visibleCount = needsScroll ? Math.max(1, sectionsHeight - 2) : sectionsHeight;
	const maxOffset = Math.max(0, total - visibleCount);

	const [scrollOffset, setScrollOffset] = useState(0);

	useEffect(() => {
		setScrollOffset(0);
		setAttSel(0);
	}, [task.id]);

	useEffect(() => {
		setAttSel((s) => Math.min(s, Math.max(0, atts.length - 1)));
	}, [atts.length]);

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
		if (input === "t" && canAttach && onAttach) {
			onAttach();
			return;
		}
		// When the task has attachments, ↑/↓ move the attachment selection
		// and PgUp/PgDn scroll the section text. With no attachments, ↑/↓
		// scroll sections (the original behavior).
		if (hasAtts) {
			if (key.upArrow || input === "k") {
				setAttSel((s) => Math.max(0, s - 1));
				return;
			}
			if (key.downArrow || input === "j") {
				setAttSel((s) => Math.min(atts.length - 1, s + 1));
				return;
			}
			if (key.return && onViewAttachment) {
				const att = atts[attSel];
				if (att) onViewAttachment(att);
				return;
			}
			if (input === "o" && onOpenAttachment) {
				const att = atts[attSel];
				if (att) onOpenAttachment(att);
				return;
			}
			if (input === "d" && onRemoveAttachment) {
				const att = atts[attSel];
				if (att) onRemoveAttachment(att);
				return;
			}
		} else {
			if (key.upArrow || input === "k") {
				setScrollOffset((o) => Math.max(0, o - 1));
				return;
			}
			if (key.downArrow || input === "j") {
				setScrollOffset((o) => Math.min(maxOffset, o + 1));
				return;
			}
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

	const hints: string[] = [];
	if (hasAtts) {
		hints.push("↑/↓ files", "PgUp/Dn scroll");
		if (onViewAttachment) hints.push("Enter view");
		if (onOpenAttachment) hints.push("o open");
		if (onRemoveAttachment) hints.push("d remove");
	} else {
		hints.push("↑/↓ scroll");
	}
	if (canAttach && onAttach) hints.push("t attach");
	hints.push("e edit");
	if (onEditExternal) hints.push("E $EDITOR");
	hints.push("Esc / q close");
	const footerHint = hints.join(" · ");

	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor={theme.borderFocused}
			width={width}
			height={height}
			paddingX={2}
			paddingY={1}
			overflowY="hidden"
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
				<Text color={theme.textDim}>{task.assignee ? `@${task.assignee}` : "unassigned"}</Text>
				{task.priority ? (
					<>
						<Text color={theme.textMuted}>{"  ·  "}</Text>
						<Text color={theme.priority[task.priority]}>{`!${task.priority}`}</Text>
					</>
				) : null}
			</Box>

			{hasTags ? (
				<Text color={theme.textDim}>{task.tags.map((t) => `#${t}`).join(" ")}</Text>
			) : null}
			{hasDeps ? <Text color={theme.textDim}>depends on: {task.depends_on.join(", ")}</Text> : null}

			<Box
				marginTop={1}
				flexDirection="column"
				width={innerWidth}
				height={sectionsHeight}
				overflowY="hidden"
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

			{hasAtts ? (
				<Box marginTop={1} flexDirection="column" width={innerWidth}>
					<Text color={theme.textDim} bold>
						{`Attachments (${atts.length})`}
					</Text>
					{visibleAtts.map((att, i) => {
						const idx = attStart + i;
						const selected = idx === attSel;
						return (
							<Text key={att.id} wrap="truncate-end" color={selected ? theme.accent : theme.text}>
								{selected ? "› " : "  "}
								{att.name}
								<Text color={theme.textMuted}>{`  ${formatBytes(att.size)}`}</Text>
							</Text>
						);
					})}
					{attMore > 0 ? (
						<Text color={theme.textMuted} italic>
							{`↓ ${attMore} more`}
						</Text>
					) : null}
				</Box>
			) : null}

			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					{footerHint}
				</Text>
			</Box>
		</Box>
	);
}

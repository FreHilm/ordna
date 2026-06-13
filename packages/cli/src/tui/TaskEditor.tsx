import {
	ARCHIVED_STATUS,
	type OrdnaConfig,
	type Priority,
	type Section,
	type Task,
	updateTask as updateTaskCore,
	type StoreContext,
} from "@frehilm/ordna-core";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import { useRawBackspaceDelete } from "./hooks.js";
import { LineInput } from "./LineInput.js";
import { colorForStatus, tagColor, theme } from "./theme.js";

interface Props {
	task: Task;
	ctx: StoreContext;
	onClose: () => void;
	onSaved: (task: Task) => void;
	width: number;
	height: number;
}

type Draft = {
	title: string;
	status: string;
	priority: Priority | null;
	assignee: string;
	tags: string[];
	depends_on: string[];
	sections: Section[];
};

type FieldKind =
	| { kind: "title" }
	| { kind: "status" }
	| { kind: "priority" }
	| { kind: "assignee" }
	| { kind: "tags" }
	| { kind: "depends_on" }
	| { kind: "section"; index: number };

const PRIORITIES: (Priority | null)[] = [null, "low", "medium", "high"];

function toDraft(task: Task): Draft {
	return {
		title: task.title,
		status: task.status,
		priority: task.priority,
		assignee: task.assignee ?? "",
		tags: [...task.tags],
		depends_on: [...task.depends_on],
		sections: task.sections.map((s) => ({ ...s })),
	};
}

function buildFields(draft: Draft): FieldKind[] {
	const fields: FieldKind[] = [
		{ kind: "title" },
		{ kind: "status" },
		{ kind: "priority" },
		{ kind: "assignee" },
		{ kind: "tags" },
		{ kind: "depends_on" },
	];
	draft.sections.forEach((s, i) => {
		if (s.heading !== "") fields.push({ kind: "section", index: i });
	});
	return fields;
}

function tokensToString(tokens: string[]): string {
	return tokens.join(", ");
}

function stringToTokens(value: string): string[] {
	return value
		.split(/[,\s]+/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

function statusOptions(config: OrdnaConfig): string[] {
	return [...config.statuses, ARCHIVED_STATUS];
}

function priorityLabel(p: Priority | null): string {
	return p === null ? "—" : p;
}

function offsetToRowCol(value: string, offset: number): [number, number] {
	const lines = value.split("\n");
	let acc = 0;
	for (let i = 0; i < lines.length; i += 1) {
		const len = (lines[i] ?? "").length;
		if (offset <= acc + len) return [i, offset - acc];
		acc += len + 1;
	}
	const last = Math.max(0, lines.length - 1);
	return [last, (lines[last] ?? "").length];
}

function rowColToOffset(value: string, row: number, col: number): number {
	const lines = value.split("\n");
	const r = Math.max(0, Math.min(row, lines.length - 1));
	const lineLen = (lines[r] ?? "").length;
	const c = Math.max(0, Math.min(col, lineLen));
	let acc = 0;
	for (let i = 0; i < r; i += 1) acc += (lines[i] ?? "").length + 1;
	return acc + c;
}

function isWordChar(ch: string): boolean {
	return /[A-Za-z0-9_]/.test(ch);
}

function wordLeft(value: string, cursor: number): number {
	let i = cursor;
	while (i > 0 && !isWordChar(value[i - 1] ?? "")) i -= 1;
	while (i > 0 && isWordChar(value[i - 1] ?? "")) i -= 1;
	return i;
}

function wordRight(value: string, cursor: number): number {
	let i = cursor;
	const n = value.length;
	while (i < n && !isWordChar(value[i] ?? "")) i += 1;
	while (i < n && isWordChar(value[i] ?? "")) i += 1;
	return i;
}

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

function sectionHeight(content: string, innerWidth: number): number {
	// 1 marginTop + 1 heading + content lines (paddingLeft=2)
	const contentWidth = Math.max(1, innerWidth - 2);
	const contentLines =
		content.length === 0 ? 1 : wrapText(content, contentWidth).length;
	return 1 + 1 + contentLines;
}

function MultilineEditor({
	value,
	cursor,
	width,
}: {
	value: string;
	cursor: number;
	width: number;
}): React.JSX.Element {
	const lines = value.length === 0 ? [""] : value.split("\n");
	const [cursorRow, cursorCol] = offsetToRowCol(value, cursor);
	return (
		<Box flexDirection="column" width={width}>
			{lines.map((line, i) => {
				if (i !== cursorRow) {
					return (
						<Text key={`${i}-${line.length}`} color={theme.text} wrap="wrap">
							{line}
						</Text>
					);
				}
				const before = line.slice(0, cursorCol);
				const at = line[cursorCol];
				const after = line.slice(cursorCol + 1);
				return (
					<Text key={`${i}-${line.length}-c`} color={theme.text} wrap="wrap">
						{before}
						<Text color={theme.accent} inverse>
							{at ?? " "}
						</Text>
						{after}
					</Text>
				);
			})}
		</Box>
	);
}

export function TaskEditor({
	task,
	ctx,
	onClose,
	onSaved,
	width,
	height,
}: Props): React.JSX.Element {
	const [draft, setDraft] = useState<Draft>(() => toDraft(task));
	const [focusIdx, setFocusIdx] = useState(0);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [cursor, setCursor] = useState(0);
	const [sectionScrollIdx, setSectionScrollIdx] = useState(0);
	// When set, the editor is asking the user to confirm a discard / save /
	// cancel choice instead of accepting field edits. Driven by the
	// dirty-Esc flow at the bottom of the main useInput handler.
	const [confirmExit, setConfirmExit] = useState(false);

	const baseline = useMemo(() => toDraft(task), [task]);
	const dirty = useMemo(
		() => JSON.stringify(draft) !== JSON.stringify(baseline),
		[draft, baseline],
	);

	const fields = useMemo(() => buildFields(draft), [draft]);
	const focused = fields[focusIdx] ?? fields[0];
	const innerWidth = Math.max(10, width - 4);
	const valueWidth = Math.max(10, innerWidth - 12);

	// Sections area height: total popup height minus borders/padding (4),
	// id row (1), error row (0/1), 1 marginTop above metadata, 6 metadata rows,
	// 1 marginTop above footer, 1 footer row.
	const reservedRows = 4 + 1 + (error ? 1 : 0) + 1 + 6 + 1 + 1;
	const sectionsAreaHeight = Math.max(1, height - reservedRows);

	const renderableSections = useMemo(() => {
		return draft.sections
			.map((s, i) => ({ section: s, index: i }))
			.filter((entry) => entry.section.heading !== "");
	}, [draft.sections]);

	const sectionLayout = useMemo(() => {
		// Walk renderable sections starting at sectionScrollIdx, accumulating
		// heights until we exceed the available area. Reserve indicator rows
		// (1 each) only when scrolling is needed in that direction.
		const total = renderableSections.length;
		const start = Math.max(0, Math.min(total, sectionScrollIdx));
		const hasAbove = start > 0;
		let used = hasAbove ? 1 : 0;
		let end = start;
		while (end < total) {
			const entry = renderableSections[end];
			if (!entry) break;
			const h = sectionHeight(entry.section.content, innerWidth);
			// Reserve a row for the bottom indicator if this isn't the last section
			const bottomReserve = end < total - 1 ? 1 : 0;
			if (used + h + bottomReserve > sectionsAreaHeight && end > start) break;
			used += h;
			end += 1;
		}
		return {
			start,
			end,
			aboveCount: start,
			belowCount: Math.max(0, total - end),
			total,
		};
	}, [renderableSections, sectionScrollIdx, sectionsAreaHeight, innerWidth]);

	// When the focused field is a section that's outside the current window,
	// adjust the scroll so it becomes visible. Run after render so we use the
	// just-computed layout.
	useEffect(() => {
		if (focused?.kind !== "section") return;
		const sectionIdx = renderableSections.findIndex(
			(e) => e.index === focused.index,
		);
		if (sectionIdx === -1) return;
		if (sectionIdx < sectionLayout.start) {
			setSectionScrollIdx(sectionIdx);
			return;
		}
		if (sectionIdx >= sectionLayout.end) {
			// Scroll forward by enough sections to bring this one into view.
			// Walk backward from the focused section, accumulating heights
			// until the budget is filled.
			let used = 1; // top indicator
			let newStart = sectionIdx;
			while (newStart > 0) {
				const prev = renderableSections[newStart - 1];
				if (!prev) break;
				const h = sectionHeight(prev.section.content, innerWidth);
				const bottomReserve = sectionIdx < renderableSections.length - 1 ? 1 : 0;
				const focusedH = sectionHeight(
					renderableSections[sectionIdx]?.section.content ?? "",
					innerWidth,
				);
				if (used + focusedH + h + bottomReserve > sectionsAreaHeight) break;
				newStart -= 1;
				used += h;
			}
			setSectionScrollIdx(newStart);
		}
	}, [
		focused,
		renderableSections,
		sectionLayout,
		sectionsAreaHeight,
		innerWidth,
	]);

	useEffect(() => {
		if (!editing) return;
		if (focused?.kind !== "section") return;
		const sec = draft.sections[focused.index];
		if (!sec) return;
		setCursor((c) => Math.max(0, Math.min(c, sec.content.length)));
	}, [editing, focused, draft.sections]);

	// Raw-byte backspace/forward-delete for the section editor. Ink's
	// parsed key object collapses both into `key.delete`, so we need
	// the byte stream to do the right thing. Active only while a
	// section is being edited; LineInput owns its own copy for the
	// title/assignee/tags/depends_on text fields.
	const sectionEditActive =
		editing &&
		focused?.kind === "section" &&
		!confirmExit &&
		!saving &&
		draft.sections[focused.index] !== undefined;
	const sectionIdx =
		focused?.kind === "section" ? focused.index : -1;
	useRawBackspaceDelete(
		() => {
			if (sectionIdx < 0) return;
			const section = draft.sections[sectionIdx];
			if (!section) return;
			if (cursor === 0) return;
			const next =
				section.content.slice(0, cursor - 1) +
				section.content.slice(cursor);
			setDraft((d) => ({
				...d,
				sections: d.sections.map((s, i) =>
					i === sectionIdx ? { ...s, content: next } : s,
				),
			}));
			setCursor(cursor - 1);
		},
		() => {
			if (sectionIdx < 0) return;
			const section = draft.sections[sectionIdx];
			if (!section) return;
			if (cursor >= section.content.length) return;
			const next =
				section.content.slice(0, cursor) +
				section.content.slice(cursor + 1);
			setDraft((d) => ({
				...d,
				sections: d.sections.map((s, i) =>
					i === sectionIdx ? { ...s, content: next } : s,
				),
			}));
			// Cursor stays put.
		},
		sectionEditActive,
	);

	const save = async (): Promise<boolean> => {
		setSaving(true);
		setError(null);
		try {
			const updated = await updateTaskCore(
				task.id,
				{
					title: draft.title.trim(),
					status: draft.status,
					assignee: draft.assignee.trim() === "" ? null : draft.assignee.trim(),
					priority: draft.priority,
					tags: draft.tags,
					depends_on: draft.depends_on,
					sections: draft.sections,
				},
				ctx,
			);
			onSaved(updated);
			return true;
		} catch (e) {
			setError((e as Error).message);
			setSaving(false);
			return false;
		}
	};

	useInput(async (input, key) => {
		if (saving) return;

		// Confirmation overlay intercepts everything else.
		if (confirmExit) {
			if (input === "s" || input === "S" || key.return) {
				const ok = await save();
				// On success the parent's onSaved closes the editor; on
				// failure we drop the prompt so the user can see the
				// error banner and decide what to do.
				if (!ok) setConfirmExit(false);
				return;
			}
			if (input === "d" || input === "D") {
				onClose();
				return;
			}
			if (input === "c" || input === "C" || key.escape) {
				setConfirmExit(false);
				return;
			}
			return;
		}

		if (key.ctrl && (input === "s" || input === "S")) {
			await save();
			return;
		}

		if (editing) {
			if (key.escape) {
				setEditing(false);
				return;
			}
			if (key.tab) {
				setEditing(false);
				if (key.shift) setFocusIdx((i) => Math.max(0, i - 1));
				else setFocusIdx((i) => Math.min(fields.length - 1, i + 1));
				return;
			}
			if (!focused) return;

			if (focused.kind === "status") {
				const opts = statusOptions(ctx.config);
				const cur = opts.indexOf(draft.status);
				if (key.upArrow) {
					const next = opts[Math.max(0, cur - 1)];
					if (next) setDraft((d) => ({ ...d, status: next }));
				} else if (key.downArrow) {
					const next = opts[Math.min(opts.length - 1, cur + 1)];
					if (next) setDraft((d) => ({ ...d, status: next }));
				} else if (key.return) {
					setEditing(false);
				}
				return;
			}

			if (focused.kind === "priority") {
				const cur = PRIORITIES.indexOf(draft.priority);
				if (key.upArrow) {
					const next = PRIORITIES[Math.max(0, cur - 1)];
					setDraft((d) => ({ ...d, priority: next ?? null }));
				} else if (key.downArrow) {
					const next = PRIORITIES[Math.min(PRIORITIES.length - 1, cur + 1)];
					setDraft((d) => ({ ...d, priority: next ?? null }));
				} else if (key.return) {
					setEditing(false);
				}
				return;
			}

			if (focused.kind === "section") {
				const idx = focused.index;
				const section = draft.sections[idx];
				if (!section) return;
				const content = section.content;
				const writeContent = (next: string, nextCursor: number): void => {
					const clamped = Math.max(0, Math.min(next.length, nextCursor));
					setDraft((d) => ({
						...d,
						sections: d.sections.map((s, i) =>
							i === idx ? { ...s, content: next } : s,
						),
					}));
					setCursor(clamped);
				};
				const moveCursor = (next: number): void => {
					setCursor(Math.max(0, Math.min(content.length, next)));
				};

				// Word jumps (Ctrl+Left/Right)
				if (key.ctrl && key.leftArrow) {
					moveCursor(wordLeft(content, cursor));
					return;
				}
				if (key.ctrl && key.rightArrow) {
					moveCursor(wordRight(content, cursor));
					return;
				}
				// Home / End via Ctrl+A / Ctrl+E
				if (key.ctrl && (input === "a" || input === "A")) {
					const [row] = offsetToRowCol(content, cursor);
					moveCursor(rowColToOffset(content, row, 0));
					return;
				}
				if (key.ctrl && (input === "e" || input === "E")) {
					const [row] = offsetToRowCol(content, cursor);
					moveCursor(rowColToOffset(content, row, Number.MAX_SAFE_INTEGER));
					return;
				}
				// Arrow keys
				if (key.leftArrow) {
					moveCursor(cursor - 1);
					return;
				}
				if (key.rightArrow) {
					moveCursor(cursor + 1);
					return;
				}
				if (key.upArrow) {
					const [row, col] = offsetToRowCol(content, cursor);
					if (row === 0) moveCursor(0);
					else moveCursor(rowColToOffset(content, row - 1, col));
					return;
				}
				if (key.downArrow) {
					const [row, col] = offsetToRowCol(content, cursor);
					const lines = content.split("\n");
					if (row >= lines.length - 1) moveCursor(content.length);
					else moveCursor(rowColToOffset(content, row + 1, col));
					return;
				}
				// Editing operations
				if (key.return) {
					const next = `${content.slice(0, cursor)}\n${content.slice(cursor)}`;
					writeContent(next, cursor + 1);
					return;
				}
				// Backspace / forward-delete are handled by the raw-byte
				// hook below — Ink can't tell them apart in the parsed key
				// object. See `useRawBackspaceDelete` in hooks.ts.
				if (key.backspace || key.delete) return;
				if (input && !key.ctrl && !key.meta) {
					const next = content.slice(0, cursor) + input + content.slice(cursor);
					writeContent(next, cursor + input.length);
				}
				return;
			}
			// title / assignee / tags / depends_on handled by TextInput onSubmit/onChange
			return;
		}

		// Not editing: navigation + open editor
		if (key.escape) {
			if (dirty) {
				setConfirmExit(true);
			} else {
				onClose();
			}
			return;
		}
		if (key.tab && key.shift) {
			setFocusIdx((i) => Math.max(0, i - 1));
			return;
		}
		if (key.tab) {
			setFocusIdx((i) => Math.min(fields.length - 1, i + 1));
			return;
		}
		if (key.upArrow) {
			setFocusIdx((i) => Math.max(0, i - 1));
			return;
		}
		if (key.downArrow) {
			setFocusIdx((i) => Math.min(fields.length - 1, i + 1));
			return;
		}
		if (key.return) {
			if (focused?.kind === "section") {
				const sec = draft.sections[focused.index];
				setCursor(sec ? sec.content.length : 0);
			}
			setEditing(true);
			return;
		}
	});

	const renderRow = (
		label: string,
		field: FieldKind,
		valueNode: React.ReactNode,
	): React.JSX.Element => {
		const isFocused =
			focused !== undefined &&
			focused.kind === field.kind &&
			(field.kind !== "section" ||
				(focused.kind === "section" && focused.index === field.index));
		const isEditing = isFocused && editing;
		const marker = isEditing ? "▷" : isFocused ? "▶" : " ";
		const labelColor = isFocused ? theme.accent : theme.textDim;
		return (
			<Box flexDirection="row" width={innerWidth}>
				<Box width={2}>
					<Text color={isFocused ? theme.accent : theme.textFaint}>{marker}</Text>
				</Box>
				<Box width={10}>
					<Text color={labelColor} bold={isFocused}>
						{label}
					</Text>
				</Box>
				<Box width={valueWidth}>{valueNode}</Box>
			</Box>
		);
	};

	const renderTextValue = (
		field: FieldKind,
		value: string,
		onChange: (v: string) => void,
		placeholder?: string,
	): React.ReactNode => {
		const isFocused =
			focused !== undefined &&
			focused.kind === field.kind &&
			(field.kind !== "section" ||
				(focused.kind === "section" && focused.index === field.index));
		const isEditing = isFocused && editing;
		if (isEditing) {
			return (
				<LineInput
					value={value}
					onChange={onChange}
					onSubmit={() => setEditing(false)}
					placeholder={placeholder}
				/>
			);
		}
		const display = value.length === 0 ? placeholder ?? "—" : value;
		const dim = value.length === 0;
		return (
			<Text
				color={dim ? theme.textFaint : isFocused ? theme.text : theme.textDim}
				wrap="truncate-end"
			>
				{display}
			</Text>
		);
	};

	const renderSelectValue = (
		field: FieldKind,
		display: string,
		color?: string,
	): React.ReactNode => {
		const isFocused =
			focused !== undefined && focused.kind === field.kind;
		const isEditing = isFocused && editing;
		const arrow = isEditing ? " ↑↓" : "";
		const valueColor = color ?? (isFocused ? theme.text : theme.textDim);
		return (
			<Text>
				<Text color={valueColor}>{display}</Text>
				{isEditing ? <Text color={theme.textMuted}>{arrow}</Text> : null}
			</Text>
		);
	};

	const renderTags = (): React.ReactNode => {
		const isFocused = focused?.kind === "tags";
		const isEditing = isFocused && editing;
		if (isEditing) {
			return (
				<LineInput
					value={tokensToString(draft.tags)}
					onChange={(v) => setDraft((d) => ({ ...d, tags: stringToTokens(v) }))}
					onSubmit={() => setEditing(false)}
					placeholder="comma or space separated"
				/>
			);
		}
		if (draft.tags.length === 0) {
			return <Text color={theme.textFaint}>—</Text>;
		}
		return (
			<Text wrap="truncate-end">
				{draft.tags.map((t, i) => (
					<Text key={t}>
						{i > 0 ? <Text color={theme.textFaint}> </Text> : null}
						<Text color={tagColor(t)}>#{t}</Text>
					</Text>
				))}
			</Text>
		);
	};

	const renderDependsOn = (): React.ReactNode => {
		const isFocused = focused?.kind === "depends_on";
		const isEditing = isFocused && editing;
		if (isEditing) {
			return (
				<LineInput
					value={tokensToString(draft.depends_on)}
					onChange={(v) =>
						setDraft((d) => ({ ...d, depends_on: stringToTokens(v) }))
					}
					onSubmit={() => setEditing(false)}
					placeholder="e.g. T-001, T-002"
				/>
			);
		}
		if (draft.depends_on.length === 0) {
			return <Text color={theme.textFaint}>—</Text>;
		}
		return (
			<Text color={theme.textDim} wrap="truncate-end">
				{draft.depends_on.join(", ")}
			</Text>
		);
	};

	const renderSection = (idx: number, section: Section): React.JSX.Element => {
		const field: FieldKind = { kind: "section", index: idx };
		const isFocused =
			focused?.kind === "section" && focused.index === idx;
		const isEditing = isFocused && editing;
		const marker = isEditing ? "▷" : isFocused ? "▶" : " ";
		return (
			<Box
				key={`${section.heading}-${idx}`}
				flexDirection="column"
				width={innerWidth}
				marginTop={1}
			>
				<Box>
					<Box width={2}>
						<Text color={isFocused ? theme.accent : theme.textFaint}>
							{marker}
						</Text>
					</Box>
					<Text color={isFocused ? theme.accent : theme.textDim} bold>
						{section.heading}
					</Text>
				</Box>
				<Box paddingLeft={2} width={innerWidth}>
					{isEditing ? (
						<MultilineEditor
							value={section.content}
							cursor={cursor}
							width={innerWidth - 2}
						/>
					) : section.content.length === 0 ? (
						<Text color={theme.textFaint}>—</Text>
					) : (
						<Text
							color={isFocused ? theme.text : theme.textDim}
							wrap="wrap"
						>
							{section.content}
						</Text>
					)}
				</Box>
			</Box>
		);
	};

	const statusColor = colorForStatus(draft.status);
	const priorityColor = draft.priority
		? theme.priority[draft.priority]
		: theme.textFaint;

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
				<Text color={theme.textMuted}>{"  edit"}</Text>
				{saving ? (
					<Text color={theme.textMuted}>{"  · saving…"}</Text>
				) : null}
				{dirty && !confirmExit && !saving ? (
					<Text color={theme.accent2}>{"  · unsaved"}</Text>
				) : null}
			</Box>

			{error ? (
				<Box marginTop={1}>
					<Text color="#ef4444">{error}</Text>
				</Box>
			) : null}

			{confirmExit ? (
				<Box flexDirection="column" marginTop={2} paddingX={2}>
					<Text color={theme.accent2} bold>
						Unsaved changes
					</Text>
					<Box marginTop={1}>
						<Text color={theme.text}>
							You've made changes to{" "}
							<Text color={theme.accent} bold>
								{task.id}
							</Text>
							. What would you like to do?
						</Text>
					</Box>
					<Box marginTop={1} flexDirection="column">
						<Text>
							<Text color={theme.accent} bold>
								{" S "}
							</Text>
							<Text color={theme.text}>save and close</Text>
						</Text>
						<Text>
							<Text color={theme.accent} bold>
								{" D "}
							</Text>
							<Text color={theme.text}>discard changes and close</Text>
						</Text>
						<Text>
							<Text color={theme.accent} bold>
								{" C "}
							</Text>
							<Text color={theme.text}>keep editing</Text>
						</Text>
					</Box>
					<Box marginTop={2}>
						<Text color={theme.textMuted} italic>
							Enter saves · Esc cancels
						</Text>
					</Box>
				</Box>
			) : (
			<>
			<Box marginTop={1} flexDirection="column">
				{renderRow(
					"Title",
					{ kind: "title" },
					renderTextValue(
						{ kind: "title" },
						draft.title,
						(v) => setDraft((d) => ({ ...d, title: v })),
					),
				)}
				{renderRow(
					"Status",
					{ kind: "status" },
					renderSelectValue({ kind: "status" }, draft.status, statusColor),
				)}
				{renderRow(
					"Priority",
					{ kind: "priority" },
					renderSelectValue(
						{ kind: "priority" },
						priorityLabel(draft.priority),
						priorityColor,
					),
				)}
				{renderRow(
					"Assignee",
					{ kind: "assignee" },
					renderTextValue(
						{ kind: "assignee" },
						draft.assignee,
						(v) => setDraft((d) => ({ ...d, assignee: v })),
						"unassigned",
					),
				)}
				{renderRow("Tags", { kind: "tags" }, renderTags())}
				{renderRow("Depends", { kind: "depends_on" }, renderDependsOn())}
			</Box>

			<Box
				flexDirection="column"
				width={innerWidth}
				height={sectionsAreaHeight}
			>
				{sectionLayout.aboveCount > 0 ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						↑ {sectionLayout.aboveCount} more
					</Text>
				) : null}
				{renderableSections
					.slice(sectionLayout.start, sectionLayout.end)
					.map((entry) => renderSection(entry.index, entry.section))}
				{sectionLayout.belowCount > 0 ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						↓ {sectionLayout.belowCount} more
					</Text>
				) : null}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					{editing
						? focused?.kind === "section"
							? "←/→/↑/↓ move · Ctrl+←/→ word · Ctrl+A/E line · Esc back · Ctrl+S save"
							: focused?.kind === "status" || focused?.kind === "priority"
								? "↑/↓ change · Enter/Esc back · Ctrl+S save"
								: "Enter confirm · Esc back · Ctrl+S save"
						: "Tab field · Enter edit · Ctrl+S save · Esc cancel"}
				</Text>
			</Box>
			</>
			)}
		</Box>
	);
}

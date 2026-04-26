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
import TextInput from "ink-text-input";
import React, { useMemo, useState } from "react";
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

function MultilineEditor({
	value,
	onChange,
	width,
}: {
	value: string;
	onChange: (next: string) => void;
	width: number;
}): React.JSX.Element {
	const lines = value.length === 0 ? [""] : value.split("\n");
	return (
		<Box flexDirection="column" width={width}>
			{lines.map((line, i) => {
				const isLast = i === lines.length - 1;
				return (
					<Text key={`${i}-${line.length}`} color={theme.text} wrap="wrap">
						{line}
						{isLast ? <Text color={theme.accent} inverse>{" "}</Text> : null}
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

	const fields = useMemo(() => buildFields(draft), [draft]);
	const focused = fields[focusIdx] ?? fields[0];
	const innerWidth = Math.max(10, width - 4);
	const valueWidth = Math.max(10, innerWidth - 12);

	const save = async (): Promise<void> => {
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
		} catch (e) {
			setError((e as Error).message);
			setSaving(false);
		}
	};

	useInput(async (input, key) => {
		if (saving) return;

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
				if (key.return) {
					const next = `${section.content}\n`;
					setDraft((d) => ({
						...d,
						sections: d.sections.map((s, i) => (i === idx ? { ...s, content: next } : s)),
					}));
					return;
				}
				if (key.backspace || key.delete) {
					const next = section.content.slice(0, -1);
					setDraft((d) => ({
						...d,
						sections: d.sections.map((s, i) => (i === idx ? { ...s, content: next } : s)),
					}));
					return;
				}
				if (input && !key.ctrl && !key.meta) {
					const next = section.content + input;
					setDraft((d) => ({
						...d,
						sections: d.sections.map((s, i) => (i === idx ? { ...s, content: next } : s)),
					}));
				}
				return;
			}
			// title / assignee / tags / depends_on handled by TextInput onSubmit/onChange
			return;
		}

		// Not editing: navigation + open editor
		if (key.escape) {
			onClose();
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
				<TextInput
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
				<TextInput
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
				<TextInput
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
							onChange={(next) =>
								setDraft((d) => ({
									...d,
									sections: d.sections.map((s, i) =>
										i === idx ? { ...s, content: next } : s,
									),
								}))
							}
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
			</Box>

			{error ? (
				<Box marginTop={1}>
					<Text color="#ef4444">{error}</Text>
				</Box>
			) : null}

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

			<Box flexDirection="column" flexGrow={1}>
				{draft.sections.map((s, i) =>
					s.heading === "" ? null : renderSection(i, s),
				)}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					{editing
						? focused?.kind === "section"
							? "Esc back · Tab next field · Ctrl+S save"
							: focused?.kind === "status" || focused?.kind === "priority"
								? "↑/↓ change · Enter/Esc back · Ctrl+S save"
								: "Enter confirm · Esc back · Ctrl+S save"
						: "Tab field · Enter edit · Ctrl+S save · Esc cancel"}
				</Text>
			</Box>
		</Box>
	);
}

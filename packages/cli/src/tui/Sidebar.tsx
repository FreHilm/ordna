import type { Task } from "@frehilm/ordna-core";
import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { colorForStatus, tagColor, theme } from "./theme.js";

export type SidebarItem =
	| { kind: "all" }
	| { kind: "status"; status: string }
	| { kind: "archived" }
	| { kind: "priority"; value: "high" | "medium" | "low" }
	| { kind: "tag"; tag: string }
	// `name: null` filters for unassigned tasks.
	| { kind: "assignee"; name: string | null };

export interface SidebarRow {
	item: SidebarItem;
	label: string;
	count: number;
	dotColor?: string;
}

function rowKey(item: SidebarItem): string {
	switch (item.kind) {
		case "all":
			return "all";
		case "archived":
			return "archived";
		case "status":
			return `status:${item.status}`;
		case "priority":
			return `priority:${item.value}`;
		case "tag":
			return `tag:${item.tag}`;
		case "assignee":
			return `assignee:${item.name ?? "<none>"}`;
	}
}

export function buildSidebarRows(
	tasks: Task[],
	statuses: string[],
	activeFilter?: SidebarItem,
): {
	views: SidebarRow[];
	priorities: SidebarRow[];
	assignees: SidebarRow[];
	tags: SidebarRow[];
} {
	const active = tasks.filter((t) => t.status !== "archived");

	const views: SidebarRow[] = [];
	views.push({ item: { kind: "all" }, label: "All tasks", count: active.length });
	for (let i = 0; i < statuses.length; i++) {
		const s = statuses[i] as string;
		views.push({
			item: { kind: "status", status: s },
			label: s,
			count: active.filter((t) => t.status === s).length,
			dotColor: colorForStatus(s, i),
		});
	}
	views.push({
		item: { kind: "archived" },
		label: "archived",
		count: tasks.filter((t) => t.status === "archived").length,
		dotColor: theme.textMuted,
	});

	const priorities: SidebarRow[] = (["high", "medium", "low"] as const).map((p) => ({
		item: { kind: "priority", value: p },
		label: p,
		count: active.filter((t) => t.priority === p).length,
		dotColor: theme.priority[p] as string,
	}));

	// People: distinct assignees by count, plus an "unassigned" row when
	// any active task lacks one. Same cap/orphan rules as tags.
	const assigneeCounts = new Map<string, number>();
	let unassigned = 0;
	for (const t of active) {
		if (t.assignee) assigneeCounts.set(t.assignee, (assigneeCounts.get(t.assignee) ?? 0) + 1);
		else unassigned += 1;
	}
	const assignees: SidebarRow[] = [...assigneeCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([name, count]) => ({
			item: { kind: "assignee", name },
			label: `@${name}`,
			count,
			dotColor: tagColor(name),
		}));
	if (unassigned > 0) {
		assignees.push({
			item: { kind: "assignee", name: null },
			label: "unassigned",
			count: unassigned,
			dotColor: theme.textMuted,
		});
	}
	if (
		activeFilter?.kind === "assignee" &&
		!assignees.some((r) => r.item.kind === "assignee" && r.item.name === activeFilter.name)
	) {
		assignees.unshift({
			item: { kind: "assignee", name: activeFilter.name },
			label: activeFilter.name ? `@${activeFilter.name}` : "unassigned",
			count: 0,
			dotColor: activeFilter.name ? tagColor(activeFilter.name) : theme.textMuted,
		});
	}

	const tagCounts = new Map<string, number>();
	for (const t of active)
		for (const tag of t.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
	// Cap at 20 visible tags. Sorted by count descending so the most-used
	// tags surface first; low-count tags beyond the cap are hidden until
	// the user adds more tasks with them. 20 covers any realistic project
	// without overflowing the sidebar height on typical terminals.
	const tags: SidebarRow[] = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 20)
		.map(([tag, count]) => ({
			item: { kind: "tag", tag },
			label: tag,
			count,
			dotColor: tagColor(tag),
		}));

	// Keep the user's currently-selected tag visible even if archiving
	// dropped its count to zero — otherwise the filter is orphaned (no
	// matching row), the active-row highlight disappears, and `Tab`'s
	// sidebar focus lands on a key that doesn't exist in flatRows, which
	// breaks ↑/↓ navigation.
	if (
		activeFilter?.kind === "tag" &&
		!tags.some((r) => r.item.kind === "tag" && r.item.tag === activeFilter.tag)
	) {
		tags.unshift({
			item: { kind: "tag", tag: activeFilter.tag },
			label: activeFilter.tag,
			count: 0,
			dotColor: tagColor(activeFilter.tag),
		});
	}

	return { views, priorities, assignees, tags };
}

export function matchesFilter(task: Task, filter: SidebarItem): boolean {
	if (filter.kind === "all") return task.status !== "archived";
	if (filter.kind === "archived") return task.status === "archived";
	if (filter.kind === "status") return task.status === filter.status;
	if (filter.kind === "priority") return task.priority === filter.value;
	if (filter.kind === "tag") return task.tags.includes(filter.tag);
	if (filter.kind === "assignee") return (task.assignee ?? null) === filter.name;
	return true;
}

interface Props {
	rows: {
		views: SidebarRow[];
		priorities: SidebarRow[];
		assignees: SidebarRow[];
		tags: SidebarRow[];
	};
	active: SidebarItem;
	focusedKey: string | null;
	focused: boolean;
	width: number;
	height: number;
}

type SidebarLine =
	| { kind: "header"; title: string }
	| { kind: "gap" }
	| { kind: "row"; row: SidebarRow };

function buildLines(rows: Props["rows"]): SidebarLine[] {
	const lines: SidebarLine[] = [];
	const section = (title: string, sectionRows: SidebarRow[]): void => {
		if (sectionRows.length === 0) return;
		if (lines.length > 0) lines.push({ kind: "gap" });
		lines.push({ kind: "header", title });
		for (const row of sectionRows) lines.push({ kind: "row", row });
	};
	section("Views", rows.views);
	section("Priority", rows.priorities);
	section("People", rows.assignees);
	section("Tags", rows.tags);
	return lines;
}

function SidebarImpl({
	rows,
	active,
	focusedKey,
	focused,
	width,
	height,
}: Props): React.JSX.Element {
	const lines = useMemo(() => buildLines(rows), [rows]);

	// The sidebar used to render all sections into a fixed-height box
	// with NO scrolling — once People/Tags pushed the focused row below
	// the fold, the `›` marker was invisible and Tab/↑/↓ appeared to do
	// nothing. Window the lines to the available height instead, keeping
	// the focused (or active) row in view, with ↑/↓ overflow indicators.
	const maxLines = Math.max(3, height - 2); // paddingY eats 2 rows
	const needsScroll = lines.length > maxLines;
	const shown = needsScroll ? Math.max(1, maxLines - 2) : lines.length;

	const anchorKey = (focused ? focusedKey : null) ?? rowKey(active);
	let anchorIdx = lines.findIndex((l) => l.kind === "row" && rowKey(l.row.item) === anchorKey);
	if (anchorIdx < 0) anchorIdx = 0;
	const maxOffset = Math.max(0, lines.length - shown);
	const offset = Math.min(maxOffset, anchorIdx < shown ? 0 : anchorIdx - shown + 1);
	const visible = lines.slice(offset, offset + shown);
	const above = offset;
	const below = Math.max(0, lines.length - offset - shown);

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1} paddingY={1}>
			{needsScroll ? (
				<Text color={theme.textMuted} italic wrap="truncate-end">
					{above > 0 ? `↑ ${above} more` : " "}
				</Text>
			) : null}
			{visible.map((line, i) => {
				if (line.kind === "gap") {
					// biome-ignore lint/suspicious/noArrayIndexKey: gaps are positional
					return <Text key={`gap-${offset + i}`}> </Text>;
				}
				if (line.kind === "header") {
					return (
						<Text key={`h-${line.title}`} color={focused ? theme.accent : theme.textMuted} bold>
							{line.title.toUpperCase()}
						</Text>
					);
				}
				return (
					<Row
						key={rowKey(line.row.item)}
						row={line.row}
						isActive={rowKey(line.row.item) === rowKey(active)}
						isFocused={focused && focusedKey === rowKey(line.row.item)}
					/>
				);
			})}
			{needsScroll ? (
				<Text color={theme.textMuted} italic wrap="truncate-end">
					{below > 0 ? `↓ ${below} more` : " "}
				</Text>
			) : null}
		</Box>
	);
}

// Sidebar's props are all primitives or memoized refs from App, so default
// shallow equality bails on every navigation keypress (cursor moves don't
// touch filter / sidebarFocusedKey / focus / rows).
export const Sidebar = React.memo(SidebarImpl);

function Row({
	row,
	isActive,
	isFocused,
}: {
	row: SidebarRow;
	isActive: boolean;
	isFocused: boolean;
}): React.JSX.Element {
	const highlight = isFocused;
	const labelColor = highlight ? theme.accent : isActive ? theme.accent : theme.textDim;

	return (
		<Box>
			<Text wrap="truncate-end">
				<Text color={highlight ? theme.accent : theme.textFaint}>{highlight ? "› " : "  "}</Text>
				{row.dotColor ? <Text color={row.dotColor}>● </Text> : null}
				<Text color={labelColor} bold={isActive}>
					{row.label}
				</Text>
				<Text color={theme.textMuted}>{` ${row.count}`}</Text>
			</Text>
		</Box>
	);
}

export { rowKey };

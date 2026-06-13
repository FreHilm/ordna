import type { Task } from "@frehilm/ordna-core";
import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { colorForStatus, tagColor, theme } from "./theme.js";

export type SidebarItem =
	| { kind: "all" }
	| { kind: "status"; status: string }
	| { kind: "archived" }
	| { kind: "priority"; value: "high" | "medium" | "low" }
	| { kind: "tag"; tag: string };

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
	}
}

export function buildSidebarRows(
	tasks: Task[],
	statuses: string[],
	activeFilter?: SidebarItem,
): { views: SidebarRow[]; priorities: SidebarRow[]; tags: SidebarRow[] } {
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

	const tagCounts = new Map<string, number>();
	for (const t of active) for (const tag of t.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
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
		!tags.some(
			(r) => r.item.kind === "tag" && r.item.tag === activeFilter.tag,
		)
	) {
		tags.unshift({
			item: { kind: "tag", tag: activeFilter.tag },
			label: activeFilter.tag,
			count: 0,
			dotColor: tagColor(activeFilter.tag),
		});
	}

	return { views, priorities, tags };
}

export function matchesFilter(task: Task, filter: SidebarItem): boolean {
	if (filter.kind === "all") return task.status !== "archived";
	if (filter.kind === "archived") return task.status === "archived";
	if (filter.kind === "status") return task.status === filter.status;
	if (filter.kind === "priority") return task.priority === filter.value;
	if (filter.kind === "tag") return task.tags.includes(filter.tag);
	return true;
}

interface Props {
	rows: { views: SidebarRow[]; priorities: SidebarRow[]; tags: SidebarRow[] };
	active: SidebarItem;
	focusedKey: string | null;
	focused: boolean;
	width: number;
	height: number;
}

function SidebarImpl({
	rows,
	active,
	focusedKey,
	focused,
	width,
	height,
}: Props): React.JSX.Element {
	return (
		<Box
			flexDirection="column"
			width={width}
			height={height}
			paddingX={1}
			paddingY={1}
		>
			<Section title="Views" focused={focused}>
				{rows.views.map((r) => (
					<Row
						key={rowKey(r.item)}
						row={r}
						isActive={rowKey(r.item) === rowKey(active)}
						isFocused={focused && focusedKey === rowKey(r.item)}
					/>
				))}
			</Section>
			<Box marginTop={1}>
				<Section title="Priority" focused={focused}>
					{rows.priorities.map((r) => (
						<Row
							key={rowKey(r.item)}
							row={r}
							isActive={rowKey(r.item) === rowKey(active)}
							isFocused={focused && focusedKey === rowKey(r.item)}
						/>
					))}
				</Section>
			</Box>
			{rows.tags.length > 0 ? (
				<Box marginTop={1}>
					<Section title="Tags" focused={focused}>
						{rows.tags.map((r) => (
							<Row
								key={rowKey(r.item)}
								row={r}
								isActive={rowKey(r.item) === rowKey(active)}
								isFocused={focused && focusedKey === rowKey(r.item)}
							/>
						))}
					</Section>
				</Box>
			) : null}
		</Box>
	);
}

// Sidebar's props are all primitives or memoized refs from App, so default
// shallow equality bails on every navigation keypress (cursor moves don't
// touch filter / sidebarFocusedKey / focus / rows).
export const Sidebar = React.memo(SidebarImpl);

function Section({
	title,
	focused,
	children,
}: {
	title: string;
	focused: boolean;
	children: React.ReactNode;
}): React.JSX.Element {
	return (
		<Box flexDirection="column">
			<Text color={focused ? theme.accent : theme.textMuted} bold>
				{title.toUpperCase()}
			</Text>
			<Box flexDirection="column" marginTop={0}>
				{children}
			</Box>
		</Box>
	);
}

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
				<Text color={highlight ? theme.accent : theme.textFaint}>
					{highlight ? "› " : "  "}
				</Text>
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

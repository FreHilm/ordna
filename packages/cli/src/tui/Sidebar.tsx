import type { Task } from "@ordna/core";
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
	const tags: SidebarRow[] = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([tag, count]) => ({
			item: { kind: "tag", tag },
			label: tag,
			count,
			dotColor: tagColor(tag),
		}));

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

export function Sidebar({
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

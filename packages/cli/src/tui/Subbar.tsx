import { Box, Text } from "ink";
import React from "react";
import type { SidebarItem } from "./Sidebar.js";
import { theme } from "./theme.js";

function filterLabel(filter: SidebarItem): string {
	switch (filter.kind) {
		case "all":
			return "All tasks";
		case "archived":
			return "Archived";
		case "status":
			return filter.status;
		case "priority":
			return `priority: ${filter.value}`;
		case "tag":
			return `#${filter.tag}`;
		case "assignee":
			return filter.name ? `@${filter.name}` : "unassigned";
	}
}

interface Props {
	filter: SidebarItem;
	visible: number;
	total: number;
	searchQuery: string;
}

function SubbarImpl({ filter, visible, total, searchQuery }: Props): React.JSX.Element {
	return (
		<Box paddingX={1} paddingY={0}>
			<Text color={theme.text} bold>
				{filterLabel(filter)}
			</Text>
			<Text color={theme.textMuted}>{`  · ${visible} visible · ${total} total`}</Text>
			{searchQuery ? <Text color={theme.accent}>{`  · /${searchQuery}`}</Text> : null}
		</Box>
	);
}

export const Subbar = React.memo(SubbarImpl);

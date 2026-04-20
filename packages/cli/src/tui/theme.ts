export const theme = {
	text: "#ececee",
	textDim: "#a8a8b0",
	textMuted: "#76767f",
	textFaint: "#4a4a52",
	border: "#3a3a42",
	borderFocused: "#f59e0b",
	accent: "#f59e0b",
	accent2: "#fbbf24",
	selectionMarker: "#f59e0b",
	grabMarker: "#fbbf24",
	statusColors: {
		todo: "#94a3b8",
		doing: "#f59e0b",
		done: "#10b981",
	} as Record<string, string>,
	priority: {
		high: "#ef4444",
		medium: "#f59e0b",
		low: "#3b82f6",
	} as Record<string, string>,
};

const FALLBACK_STATUS_CYCLE = ["#94a3b8", "#3b82f6", "#f59e0b", "#8b5cf6", "#10b981"];

export function colorForStatus(status: string, fallbackIndex = 0): string {
	const key = status.toLowerCase();
	if (theme.statusColors[key]) return theme.statusColors[key] as string;
	return FALLBACK_STATUS_CYCLE[fallbackIndex % FALLBACK_STATUS_CYCLE.length] as string;
}

const TAG_PALETTE = ["#8b5cf6", "#3b82f6", "#f59e0b", "#10b981"];

export function tagColor(tag: string): string {
	const hash = [...tag].reduce((a, c) => a + c.charCodeAt(0), 0);
	return TAG_PALETTE[hash % TAG_PALETTE.length] as string;
}

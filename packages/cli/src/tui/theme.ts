export const theme = {
	text: "#d4d4d8",
	textDim: "#71717a",
	textMuted: "#52525b",
	border: "#3f3f46",
	borderFocused: "#a1a1aa",
	accent: "#7dd3fc",
	selectionMarker: "#7dd3fc",
	grabMarker: "#fde047",
	statusColors: {
		todo: "#71717a",
		doing: "#eab308",
		done: "#22c55e",
	} as Record<string, string>,
	priority: {
		high: "#f87171",
		medium: "#eab308",
		low: "#94a3b8",
	} as Record<string, string>,
};

export function colorForStatus(status: string): string {
	return theme.statusColors[status] ?? theme.accent;
}

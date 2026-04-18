export const theme = {
	bg: undefined,
	border: "gray",
	borderFocused: "cyan",
	textDim: "gray",
	textNormal: "white",
	textAccent: "cyan",
	statusColors: {
		todo: "gray",
		doing: "yellow",
		done: "green",
	} as Record<string, string>,
	priority: {
		high: "red",
		medium: "yellow",
		low: "blue",
	} as Record<string, string>,
};

export function colorForStatus(status: string): string {
	return theme.statusColors[status] ?? "cyan";
}

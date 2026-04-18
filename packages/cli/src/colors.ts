const isTTY = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

function wrap(code: number, text: string): string {
	if (!isTTY) return text;
	return `\x1b[${code}m${text}\x1b[0m`;
}

export const c = {
	dim: (t: string) => wrap(2, t),
	bold: (t: string) => wrap(1, t),
	red: (t: string) => wrap(31, t),
	green: (t: string) => wrap(32, t),
	yellow: (t: string) => wrap(33, t),
	blue: (t: string) => wrap(34, t),
	magenta: (t: string) => wrap(35, t),
	cyan: (t: string) => wrap(36, t),
	gray: (t: string) => wrap(90, t),
};

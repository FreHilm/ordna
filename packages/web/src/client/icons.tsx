import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base: IconProps = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round",
};

export const Icon = {
	Search: (p: IconProps) => (
		<svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}>
			<circle cx="11" cy="11" r="7" />
			<path d="m21 21-4.3-4.3" />
		</svg>
	),
	Plus: (p: IconProps) => (
		<svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M12 5v14M5 12h14" />
		</svg>
	),
	Check: (p: IconProps) => (
		<svg width="11" height="11" viewBox="0 0 24 24" {...base} strokeWidth={3} {...p}>
			<path d="M20 6 9 17l-5-5" />
		</svg>
	),
	X: (p: IconProps) => (
		<svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M18 6 6 18M6 6l12 12" />
		</svg>
	),
	Link: (p: IconProps) => (
		<svg width="12" height="12" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
			<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
		</svg>
	),
	Sun: (p: IconProps) => (
		<svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
		</svg>
	),
	Moon: (p: IconProps) => (
		<svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	),
	Board: (p: IconProps) => (
		<svg width="13" height="13" viewBox="0 0 24 24" {...base} {...p}>
			<rect x="3" y="3" width="7" height="18" rx="1" />
			<rect x="14" y="3" width="7" height="11" rx="1" />
		</svg>
	),
	List: (p: IconProps) => (
		<svg width="13" height="13" viewBox="0 0 24 24" {...base} {...p}>
			<line x1="8" y1="6" x2="21" y2="6" />
			<line x1="8" y1="12" x2="21" y2="12" />
			<line x1="8" y1="18" x2="21" y2="18" />
			<circle cx="4" cy="6" r="1" />
			<circle cx="4" cy="12" r="1" />
			<circle cx="4" cy="18" r="1" />
		</svg>
	),
	Edit: (p: IconProps) => (
		<svg width="13" height="13" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
			<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
		</svg>
	),
	Trash: (p: IconProps) => (
		<svg width="13" height="13" viewBox="0 0 24 24" {...base} {...p}>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
			<path d="M10 11v6M14 11v6" />
		</svg>
	),
	Inbox: (p: IconProps) => (
		<svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}>
			<polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
			<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
		</svg>
	),
	Hash: (p: IconProps) => (
		<svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}>
			<line x1="4" y1="9" x2="20" y2="9" />
			<line x1="4" y1="15" x2="20" y2="15" />
			<line x1="10" y1="3" x2="8" y2="21" />
			<line x1="16" y1="3" x2="14" y2="21" />
		</svg>
	),
	Command: (p: IconProps) => (
		<svg width="12" height="12" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
		</svg>
	),
	Flag: (p: IconProps) => (
		<svg width="12" height="12" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
			<line x1="4" y1="22" x2="4" y2="15" />
		</svg>
	),
	User: (p: IconProps) => (
		<svg width="13" height="13" viewBox="0 0 24 24" {...base} {...p}>
			<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</svg>
	),
} as const;

const AVATAR_HUES: Record<string, number> = {
	fredrik: 210,
	mira: 320,
	jules: 150,
	alex: 40,
	sam: 270,
};

export function Avatar({ name, size = 18 }: { name?: string | null; size?: number }): JSX.Element {
	if (!name) {
		return (
			<span
				className="avatar"
				style={{
					width: size,
					height: size,
					background: "var(--line-strong)",
					color: "var(--text-3)",
					fontSize: Math.round(size * 0.48),
				}}
			>
				?
			</span>
		);
	}
	const key = name.toLowerCase();
	const hue =
		AVATAR_HUES[key] ??
		([...name].reduce((a, c) => a + c.charCodeAt(0), 0) * 11) % 360;
	return (
		<span
			className="avatar"
			style={{
				width: size,
				height: size,
				fontSize: Math.round(size * 0.48),
				background: `oklch(0.68 0.13 ${hue})`,
			}}
		>
			{name[0]}
		</span>
	);
}

const TAG_COLORS = ["violet", "blue", "amber", "green"] as const;

export function tagColor(tag: string): string {
	const hash = [...tag].reduce((a, c) => a + c.charCodeAt(0), 0);
	return TAG_COLORS[hash % TAG_COLORS.length] as string;
}

import { useEffect } from "react";

interface Props {
	onClose: () => void;
}

const ROWS: Array<{ label: string; keys: string[] }> = [
	{ label: "Command palette", keys: ["⌘", "K"] },
	{ label: "New task", keys: ["N"] },
	{ label: "Focus search", keys: ["/"] },
	{ label: "Toggle theme", keys: ["T"] },
	{ label: "Shortcuts", keys: ["?"] },
	{ label: "Open task", keys: ["Enter"] },
	{ label: "Close / cancel", keys: ["Esc"] },
];

export function Cheatsheet({ onClose }: Props): JSX.Element {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape" || e.key === "?") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="cheat">
			<div className="cheat-title">Shortcuts</div>
			{ROWS.map((row) => (
				<div key={row.label} className="cheat-row">
					<span>{row.label}</span>
					<span className="kbd-row">
						{row.keys.map((k) => (
							<span key={k} className="kbd">
								{k}
							</span>
						))}
					</span>
				</div>
			))}
		</div>
	);
}

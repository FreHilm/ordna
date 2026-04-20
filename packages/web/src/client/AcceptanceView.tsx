import { type AcceptanceItem } from "./acceptance.js";

interface Props {
	items: AcceptanceItem[];
	onToggle?: (id: string, checked: boolean) => void;
}

export function AcceptanceView({ items, onToggle }: Props): JSX.Element {
	if (items.length === 0) {
		return <div className="ac-list-empty">No criteria.</div>;
	}
	const done = items.filter((i) => i.checked).length;
	return (
		<div className="ac-list ac-list-view">
			<div className="ac-list-head">
				<span className="ac-list-title">Acceptance Criteria</span>
				<span className="ac-list-count">
					{done} / {items.length}
				</span>
			</div>
			<ul className="ac-list-items">
				{items.map((item) => (
					<li key={item.id} className={`ac-row view ${item.checked ? "checked" : ""}`}>
						<button
							type="button"
							className={`ac-check ${item.checked ? "on" : ""}`}
							disabled={!onToggle}
							aria-label={item.checked ? "Mark incomplete" : "Mark complete"}
							onClick={() => onToggle?.(item.id, !item.checked)}
						>
							{item.checked ? "✓" : ""}
						</button>
						<span className="ac-text">{item.text}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

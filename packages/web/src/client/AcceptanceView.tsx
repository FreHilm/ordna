import { type AcceptanceItem } from "./acceptance.js";
import { Icon } from "./icons.js";

interface Props {
	items: AcceptanceItem[];
	onToggle?: (id: string, checked: boolean) => void;
}

export function AcceptanceView({ items, onToggle }: Props): JSX.Element {
	const done = items.filter((i) => i.checked).length;
	return (
		<div className="criteria-block">
			<div className="crit-head">
				<span className="section-label" style={{ margin: 0 }}>
					Acceptance Criteria
				</span>
				<span className="crit-count">
					{items.length === 0 ? "—" : `${done} / ${items.length}`}
				</span>
			</div>
			{items.length === 0 ? (
				<div className="crit" style={{ color: "var(--text-4)", fontStyle: "italic" }}>
					No criteria yet.
				</div>
			) : (
				<div>
					{items.map((item) => (
						<div key={item.id} className={`crit ${item.checked ? "done" : ""}`}>
							<button
								type="button"
								role="checkbox"
								aria-checked={item.checked}
								className={`check ${item.checked ? "on" : ""}`}
								aria-label={item.checked ? "Mark incomplete" : "Mark complete"}
								disabled={!onToggle}
								onClick={() => onToggle?.(item.id, !item.checked)}
							>
								{item.checked ? <Icon.Check /> : null}
							</button>
							<span>{item.text}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

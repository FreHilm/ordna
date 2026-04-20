import { useEffect, useRef } from "react";
import { type AcceptanceItem, makeItem } from "./acceptance.js";
import { Icon } from "./icons.js";

interface Props {
	items: AcceptanceItem[];
	onChange: (next: AcceptanceItem[]) => void;
}

export function AcceptanceList({ items, onChange }: Props): JSX.Element {
	const autoFocusId = useRef<string | null>(null);

	const done = items.filter((i) => i.checked).length;
	const total = items.length;

	const update = (id: string, patch: Partial<AcceptanceItem>): void => {
		onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
	};

	const remove = (id: string): void => {
		onChange(items.filter((i) => i.id !== id));
	};

	const add = (): void => {
		const item = makeItem();
		autoFocusId.current = item.id;
		onChange([...items, item]);
	};

	return (
		<div className="criteria-block">
			<div className="crit-head">
				<span className="section-label" style={{ margin: 0 }}>
					Acceptance Criteria
				</span>
				<span className="crit-count">
					{total === 0 ? "—" : `${done} / ${total}`}
				</span>
			</div>
			<div>
				{items.map((item, idx) => (
					<AcceptanceRow
						key={item.id}
						item={item}
						autoFocus={autoFocusId.current === item.id}
						onToggle={(checked) => update(item.id, { checked })}
						onChangeText={(text) => update(item.id, { text })}
						onRemove={() => remove(item.id)}
						onEnter={() => {
							const next = makeItem();
							autoFocusId.current = next.id;
							const copy = items.slice();
							copy.splice(idx + 1, 0, next);
							onChange(copy);
						}}
					/>
				))}
			</div>
			<button type="button" className="crit-add" onClick={add}>
				+ Add criterion
			</button>
		</div>
	);
}

interface RowProps {
	item: AcceptanceItem;
	autoFocus: boolean;
	onToggle: (checked: boolean) => void;
	onChangeText: (text: string) => void;
	onRemove: () => void;
	onEnter: () => void;
}

function AcceptanceRow({
	item,
	autoFocus,
	onToggle,
	onChangeText,
	onRemove,
	onEnter,
}: RowProps): JSX.Element {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	return (
		<div className={`crit ${item.checked ? "done" : ""}`}>
			<button
				type="button"
				role="checkbox"
				aria-checked={item.checked}
				className={`check ${item.checked ? "on" : ""}`}
				aria-label={item.checked ? "Mark incomplete" : "Mark complete"}
				onClick={() => onToggle(!item.checked)}
			>
				{item.checked ? <Icon.Check /> : null}
			</button>
			<input
				ref={inputRef}
				type="text"
				className="crit-input"
				value={item.text}
				placeholder="Describe the criterion…"
				onChange={(e) => onChangeText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						onEnter();
					} else if (e.key === "Backspace" && item.text === "") {
						e.preventDefault();
						onRemove();
					}
				}}
			/>
			<button
				type="button"
				className="crit-remove"
				aria-label="Remove criterion"
				title="Remove"
				onClick={onRemove}
			>
				×
			</button>
		</div>
	);
}

import { useEffect, useRef } from "react";
import { type AcceptanceItem, makeItem } from "./acceptance.js";

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
		<div className="ac-list">
			<div className="ac-list-head">
				<span className="ac-list-title">Acceptance Criteria</span>
				<span className="ac-list-count">
					{total === 0 ? "none" : `${done} / ${total}`}
				</span>
			</div>

			{items.length === 0 ? (
				<div className="ac-list-empty">No criteria yet.</div>
			) : (
				<ul className="ac-list-items">
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
				</ul>
			)}

			<button type="button" className="ac-add" onClick={add}>
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
		<li className={`ac-row ${item.checked ? "checked" : ""}`}>
			<button
				type="button"
				role="checkbox"
				aria-checked={item.checked}
				className={`ac-check ${item.checked ? "on" : ""}`}
				aria-label={item.checked ? "Mark incomplete" : "Mark complete"}
				onClick={() => onToggle(!item.checked)}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.5 8.5 L7 12 L13 5" />
				</svg>
			</button>
			<input
				ref={inputRef}
				type="text"
				className="ac-input"
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
				className="ac-remove"
				aria-label="Remove criterion"
				title="Remove"
				onClick={onRemove}
			>
				×
			</button>
		</li>
	);
}

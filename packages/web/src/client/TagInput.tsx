import { useRef, useState } from "react";

interface Props {
	id?: string;
	values: string[];
	onChange: (next: string[]) => void;
	placeholder?: string;
	allowSpaces?: boolean;
	chipClassName?: string;
}

export function TagInput({
	id,
	values,
	onChange,
	placeholder,
	allowSpaces,
	chipClassName = "chip tag",
}: Props): JSX.Element {
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const commit = (raw: string): void => {
		const token = raw.trim();
		if (token.length === 0) return;
		if (values.includes(token)) {
			setDraft("");
			return;
		}
		onChange([...values, token]);
		setDraft("");
	};

	const removeAt = (idx: number): void => {
		onChange(values.filter((_, i) => i !== idx));
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
		const key = e.key;
		if (key === "Enter" || key === "," || key === ";") {
			e.preventDefault();
			commit(draft);
			return;
		}
		if (key === " " && !allowSpaces) {
			e.preventDefault();
			commit(draft);
			return;
		}
		if (key === "Backspace" && draft.length === 0 && values.length > 0) {
			e.preventDefault();
			removeAt(values.length - 1);
			return;
		}
	};

	const onPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
		const pasted = e.clipboardData.getData("text");
		if (!pasted) return;
		const parts = pasted.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
		if (parts.length <= 1) return;
		e.preventDefault();
		const merged = [...values];
		for (const p of parts) if (!merged.includes(p)) merged.push(p);
		onChange(merged);
		setDraft("");
	};

	const onBlur = (): void => {
		if (draft.trim().length > 0) commit(draft);
	};

	return (
		<div
			className="tag-input"
			onClick={() => inputRef.current?.focus()}
			onKeyDown={(e) => {
				if (e.target === e.currentTarget && e.key === "Enter") {
					inputRef.current?.focus();
				}
			}}
		>
			{values.map((tag, idx) => (
				<span key={`${tag}-${idx}`} className={`${chipClassName} removable`}>
					{tag}
					<button
						type="button"
						className="chip-remove"
						aria-label={`Remove ${tag}`}
						onClick={(e) => {
							e.stopPropagation();
							removeAt(idx);
						}}
					>
						×
					</button>
				</span>
			))}
			<input
				id={id}
				ref={inputRef}
				type="text"
				className="tag-input-field"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={onKeyDown}
				onPaste={onPaste}
				onBlur={onBlur}
				placeholder={values.length === 0 ? placeholder : ""}
			/>
		</div>
	);
}

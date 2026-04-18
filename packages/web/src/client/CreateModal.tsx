import { useEffect, useRef, useState } from "react";

interface Props {
	onSubmit: (title: string) => void;
	onCancel: () => void;
}

export function CreateModal({ onSubmit, onCancel }: Props): JSX.Element {
	const [title, setTitle] = useState("");
	const ref = useRef<HTMLInputElement>(null);

	useEffect(() => {
		ref.current?.focus();
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") onCancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onCancel]);

	return (
		<div className="modal-backdrop" onClick={onCancel}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<h2>New task</h2>
				<input
					ref={ref}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Task title"
					onKeyDown={(e) => {
						if (e.key === "Enter" && title.trim().length > 0) onSubmit(title.trim());
					}}
				/>
				<div className="row">
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button
						type="button"
						className="primary"
						disabled={title.trim().length === 0}
						onClick={() => onSubmit(title.trim())}
					>
						Create
					</button>
				</div>
			</div>
		</div>
	);
}

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons.js";

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
		<div className="scrim" onClick={onCancel}>
			<div
				className="modal"
				style={{ maxWidth: 520 }}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="modal-head">
					<span className="section-label" style={{ margin: 0 }}>
						New task
					</span>
					<div className="modal-actions">
						<button type="button" className="btn-icon" onClick={onCancel} title="Close">
							<Icon.X />
						</button>
					</div>
				</div>
				<div style={{ padding: "18px 20px 20px" }}>
					<input
						ref={ref}
						className="input"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Task title"
						onKeyDown={(e) => {
							if (e.key === "Enter" && title.trim().length > 0) onSubmit(title.trim());
						}}
					/>
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							gap: 8,
							marginTop: 14,
						}}
					>
						<button type="button" className="btn" onClick={onCancel}>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn-primary"
							disabled={title.trim().length === 0}
							onClick={() => onSubmit(title.trim())}
						>
							Create
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

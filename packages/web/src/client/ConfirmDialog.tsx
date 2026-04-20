import { useEffect, useRef } from "react";

interface Props {
	title: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	danger,
	onConfirm,
	onCancel,
}: Props): JSX.Element {
	const confirmRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		confirmRef.current?.focus();
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") onCancel();
			else if (e.key === "Enter") onConfirm();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onCancel, onConfirm]);

	return (
		<div className="scrim" onClick={onCancel}>
			<div
				className="modal confirm-dialog"
				onClick={(e) => e.stopPropagation()}
			>
				<h2>{title}</h2>
				<p>{message}</p>
				<div className="row">
					<button type="button" onClick={onCancel}>
						{cancelLabel}
					</button>
					<button
						ref={confirmRef}
						type="button"
						className={danger ? "danger" : "primary"}
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}

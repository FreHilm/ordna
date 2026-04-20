import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useRef } from "react";
import type { WireTask } from "../shared/types.js";

interface Props {
	task: WireTask;
	overlay?: boolean;
	onSelect?: (id: string) => void;
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
}

const CLICK_THRESHOLD_PX = 5;

export function Card({ task, overlay, onSelect, onEdit, onDelete }: Props): JSX.Element {
	if (overlay) {
		return <CardContent task={task} className="card overlay" />;
	}
	return (
		<DraggableCard task={task} onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />
	);
}

function DraggableCard({
	task,
	onSelect,
	onEdit,
	onDelete,
}: {
	task: WireTask;
	onSelect?: (id: string) => void;
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
}): JSX.Element {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: task.id,
	});
	const downPos = useRef<{ x: number; y: number } | null>(null);

	const style = {
		transform: CSS.Translate.toString(transform),
		opacity: isDragging ? 0 : 1,
	};

	const stopDrag = (e: React.PointerEvent | React.MouseEvent): void => {
		e.stopPropagation();
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="card-wrap"
			{...attributes}
			{...listeners}
			onPointerDownCapture={(e) => {
				downPos.current = { x: e.clientX, y: e.clientY };
			}}
			onPointerUp={(e) => {
				const start = downPos.current;
				downPos.current = null;
				if (!onSelect || !start) return;
				if (isDragging) return;
				const dx = Math.abs(e.clientX - start.x);
				const dy = Math.abs(e.clientY - start.y);
				if (dx < CLICK_THRESHOLD_PX && dy < CLICK_THRESHOLD_PX) onSelect(task.id);
			}}
		>
			<CardContent task={task} className={`card ${isDragging ? "dragging" : ""}`} />
			<div className="card-actions" onPointerDown={stopDrag} onMouseDown={stopDrag}>
				<button
					type="button"
					className="card-action"
					title="Edit"
					aria-label="Edit task"
					onClick={(e) => {
						stopDrag(e);
						onEdit?.(task.id);
					}}
				>
					Edit
				</button>
				<button
					type="button"
					className="card-action danger"
					title="Delete"
					aria-label="Delete task"
					onClick={(e) => {
						stopDrag(e);
						onDelete?.(task.id);
					}}
				>
					Delete
				</button>
			</div>
		</div>
	);
}

function CardContent({
	task,
	className,
}: {
	task: WireTask;
	className: string;
}): JSX.Element {
	return (
		<div className={className}>
			<div className="card-head">
				<span className="card-id">{task.id}</span>
				{task.priority ? (
					<span className={`card-priority ${task.priority}`}>{task.priority}</span>
				) : null}
			</div>
			<div className="card-title">{task.title}</div>
			{task.assignee || task.tags.length > 0 ? (
				<div className="card-meta">
					{task.assignee ? <span className="card-assignee">@{task.assignee}</span> : null}
					{task.tags.map((t) => (
						<span key={t} className="card-tag">
							#{t}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

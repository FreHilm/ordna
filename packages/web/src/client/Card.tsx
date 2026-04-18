import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { WireTask } from "../shared/types.js";

interface Props {
	task: WireTask;
}

export function Card({ task }: Props): JSX.Element {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: task.id,
	});

	const style = {
		transform: CSS.Translate.toString(transform),
	};

	return (
		<div
			ref={setNodeRef}
			className={`card ${isDragging ? "dragging" : ""}`}
			style={style}
			{...attributes}
			{...listeners}
		>
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

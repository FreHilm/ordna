import { useDroppable } from "@dnd-kit/core";
import type { WireTask } from "../shared/types.js";
import { Card } from "./Card.js";

interface Props {
	status: string;
	tasks: WireTask[];
}

export function Column({ status, tasks }: Props): JSX.Element {
	const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

	return (
		<div ref={setNodeRef} className={`column ${isOver ? "drop-target" : ""}`}>
			<div className="column-header">
				<span className={`dot status-dot ${status}`} />
				<span className="title">{status}</span>
				<span className="count">{tasks.length}</span>
			</div>
			<div className="column-body">
				{tasks.length === 0 ? <div className="empty">Drop tasks here</div> : null}
				{tasks.map((task) => (
					<Card key={task.id} task={task} />
				))}
			</div>
		</div>
	);
}

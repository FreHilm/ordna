import { useDroppable } from "@dnd-kit/core";
import type { WireTask } from "../shared/types.js";
import { Card } from "./Card.js";

export const COLUMN_COLORS = ["slate", "blue", "amber", "violet", "emerald"] as const;

const STATUS_COLOR_MAP: Record<string, string> = {
	todo: "slate",
	backlog: "slate",
	"in progress": "amber",
	doing: "amber",
	review: "violet",
	done: "emerald",
	blocked: "blue",
};

export function colorForStatus(status: string, fallbackIndex: number): string {
	const key = status.toLowerCase();
	return STATUS_COLOR_MAP[key] ?? (COLUMN_COLORS[fallbackIndex % COLUMN_COLORS.length] as string);
}

interface Props {
	status: string;
	color: string;
	tasks: WireTask[];
	onSelect?: (id: string) => void;
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
}

export function Column({
	status,
	color,
	tasks,
	onSelect,
	onEdit,
	onDelete,
}: Props): JSX.Element {
	const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

	return (
		<div className="col">
			<div className="col-head">
				<span className={`col-dot ${color}`} />
				<span className="col-title">{status}</span>
				<span className="col-count">{tasks.length}</span>
			</div>
			<div ref={setNodeRef} className={`col-body ${isOver ? "drop-active" : ""}`}>
				{tasks.length === 0 ? <div className="col-empty">Drop tasks here</div> : null}
				{tasks.map((task) => (
					<Card
						key={task.id}
						task={task}
						onSelect={onSelect}
						onEdit={onEdit}
						onDelete={onDelete}
					/>
				))}
			</div>
		</div>
	);
}

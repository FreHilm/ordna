import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef } from "react";
import type { WireTask } from "../shared/types.js";
import { ACCEPTANCE_HEADING_RE, parseAcceptance } from "./acceptance.js";
import { Avatar, Icon, tagColor } from "./icons.js";

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

	const stop = (e: React.PointerEvent | React.MouseEvent): void => {
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
			<div className="card-actions" onPointerDown={stop} onMouseDown={stop}>
				<button
					type="button"
					className="card-action"
					title="Edit"
					aria-label="Edit task"
					onClick={(e) => {
						stop(e);
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
						stop(e);
						onDelete?.(task.id);
					}}
				>
					Delete
				</button>
			</div>
		</div>
	);
}

function CardContent({ task, className }: { task: WireTask; className: string }): JSX.Element {
	const acStats = useMemo(() => {
		const section = task.sections.find((s) => ACCEPTANCE_HEADING_RE.test(s.heading.trim()));
		if (!section) return null;
		const items = parseAcceptance(section.content);
		if (items.length === 0) return null;
		const done = items.filter((i) => i.checked).length;
		return { done, total: items.length };
	}, [task]);

	const hasBottom = Boolean(task.assignee || acStats);

	return (
		<div className={className}>
			<div className="card-row">
				<span className="card-id">{task.id}</span>
				{task.priority ? (
					<span className={`prio-badge ${task.priority}`}>{task.priority}</span>
				) : null}
				{task.depends_on.length > 0 ? (
					<span className="card-deps">
						<Icon.Link /> {task.depends_on.length}
					</span>
				) : null}
			</div>

			<div className="card-title">{task.title}</div>

			{task.tags.length > 0 ? (
				<div className="card-tags">
					{task.tags.slice(0, 4).map((t) => (
						<span key={t} className={`chip ${tagColor(t)}`}>
							#{t}
						</span>
					))}
				</div>
			) : null}

			{hasBottom ? (
				<div className="card-bottom">
					{task.assignee ? (
						<span className="card-bottom-item">
							<Avatar name={task.assignee} size={16} />
							<span style={{ color: "var(--text-3)" }}>@{task.assignee}</span>
						</span>
					) : null}
					{acStats ? (
						<span
							className="card-bottom-item card-bottom-end"
							style={{ gap: 6 }}
						>
							<div className="progress-track" style={{ width: 60 }}>
								<div
									className="progress-fill"
									style={{ width: `${(acStats.done / acStats.total) * 100}%` }}
								/>
							</div>
							<span style={{ fontVariantNumeric: "tabular-nums" }}>
								{acStats.done}/{acStats.total}
							</span>
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

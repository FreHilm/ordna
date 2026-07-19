import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useRef } from "react";
import type { AgentHookInfo, WireTask } from "../shared/types.js";
import { ACCEPTANCE_HEADING_RE, parseAcceptance } from "./acceptance.js";
import { Avatar, Icon, tagColor } from "./icons.js";

interface Props {
	task: WireTask;
	overlay?: boolean;
	compact?: boolean;
	onSelect?: (id: string) => void;
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
	agentHook?: AgentHookInfo | null;
	onAgent?: (id: string) => void;
}

const CLICK_THRESHOLD_PX = 5;

export function Card({
	task,
	overlay,
	compact,
	onSelect,
	onEdit,
	onDelete,
	agentHook,
	onAgent,
}: Props): JSX.Element {
	if (overlay) {
		return (
			<CardContent
				task={task}
				compact={compact}
				className={`card overlay${compact ? " compact" : ""}`}
			/>
		);
	}
	return (
		<DraggableCard
			task={task}
			compact={compact}
			onSelect={onSelect}
			onEdit={onEdit}
			onDelete={onDelete}
			agentHook={agentHook}
			onAgent={onAgent}
		/>
	);
}

function DraggableCard({
	task,
	compact,
	onSelect,
	onEdit,
	onDelete,
	agentHook,
	onAgent,
}: {
	task: WireTask;
	compact?: boolean;
	onSelect?: (id: string) => void;
	onEdit?: (id: string) => void;
	onDelete?: (id: string) => void;
	agentHook?: AgentHookInfo | null;
	onAgent?: (id: string) => void;
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
			<CardContent
				task={task}
				compact={compact}
				className={`card ${isDragging ? "dragging" : ""}${compact ? " compact" : ""}`}
			/>
			<div className="card-actions" onPointerDown={stop} onPointerUp={stop} onMouseDown={stop}>
				{agentHook?.enabled ? (
					<button
						type="button"
						className="card-action agent"
						title={`Send to ${agentHook.label}`}
						aria-label={`Send to ${agentHook.label}`}
						onClick={(e) => {
							stop(e);
							onAgent?.(task.id);
						}}
					>
						{agentHook.label}
					</button>
				) : null}
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

function CardContent({
	task,
	className,
	compact,
}: {
	task: WireTask;
	className: string;
	compact?: boolean;
}): JSX.Element {
	const acStats = useMemo(() => {
		const section = task.sections.find((s) => ACCEPTANCE_HEADING_RE.test(s.heading.trim()));
		if (!section) return null;
		const items = parseAcceptance(section.content);
		if (items.length === 0) return null;
		const done = items.filter((i) => i.checked).length;
		return { done, total: items.length };
	}, [task]);

	// Compact mode moves progress to a vertical bar on the card's right
	// edge (no numbers), so the bottom row only exists for the assignee.
	const hasBottom = Boolean(task.assignee || (acStats && !compact));

	return (
		<div className={className}>
			{compact && acStats ? (
				<div className="progress-vert" title={`${acStats.done}/${acStats.total} done`}>
					<div
						className="progress-vert-fill"
						style={{ height: `${(acStats.done / acStats.total) * 100}%` }}
					/>
				</div>
			) : null}
			{compact ? (
				// Compact header: id + title + deps + one-letter priority on a
				// single row (full word in the hover tooltip). The id lives
				// INSIDE the title span so wrapped lines flow back to the left
				// edge instead of hanging indented under the title column.
				<div className="card-head">
					<span className="card-title">
						<span className="card-id">{task.id}</span>
						{task.title}
					</span>
					{task.depends_on.length > 0 ? (
						<span className="card-deps">
							<Icon.Link /> {task.depends_on.length}
						</span>
					) : null}
					{task.priority ? (
						<span
							className={`prio-badge letter ${task.priority}`}
							title={task.priority}
							aria-label={`priority: ${task.priority}`}
						>
							{task.priority[0]?.toUpperCase()}
						</span>
					) : null}
				</div>
			) : (
				// Comfortable header: the classic two-row layout — id row with
				// the spelled-out priority badge, title beneath.
				<>
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
				</>
			)}

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
					{acStats && !compact ? (
						<span className="card-bottom-item card-bottom-end" style={{ gap: 6 }}>
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

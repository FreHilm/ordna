import {
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import type { OrdnaConfig, WireTask, WsEvent } from "../shared/types.js";
import { api } from "./api.js";
import { Column } from "./Column.js";
import { CreateModal } from "./CreateModal.js";

function groupBy(tasks: WireTask[], statuses: string[]): Record<string, WireTask[]> {
	const groups: Record<string, WireTask[]> = {};
	for (const s of statuses) groups[s] = [];
	for (const t of tasks) (groups[t.status] ??= []).push(t);
	return groups;
}

export function App(): JSX.Element {
	const [config, setConfig] = useState<OrdnaConfig | null>(null);
	const [tasks, setTasks] = useState<WireTask[]>([]);
	const [query, setQuery] = useState("");
	const [toast, setToast] = useState<{ message: string; kind: "info" | "error" } | null>(null);
	const [showCreate, setShowCreate] = useState(false);

	useEffect(() => {
		void (async () => {
			const [cfg, list] = await Promise.all([api.config(), api.list()]);
			setConfig(cfg);
			setTasks(list);
		})();
	}, []);

	useEffect(() => {
		const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
		ws.onmessage = (event) => {
			const evt = JSON.parse(event.data) as WsEvent;
			setTasks((prev) => {
				if (evt.type === "removed") return prev.filter((t) => t.id !== evt.id);
				const next = prev.filter((t) => t.id !== evt.task.id);
				next.push(evt.task);
				return next;
			});
		};
		return () => ws.close();
	}, []);

	const statuses = config?.statuses ?? ["todo", "doing", "done"];
	const filtered = useMemo<WireTask[]>(() => {
		if (!query) return tasks;
		const q = query.toLowerCase();
		return tasks.filter(
			(t) =>
				t.title.toLowerCase().includes(q) ||
				t.id.toLowerCase().includes(q) ||
				t.tags.some((tag) => tag.toLowerCase().includes(q)),
		);
	}, [tasks, query]);

	const groups = useMemo(() => groupBy(filtered, statuses), [filtered, statuses]);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor),
	);

	const onDragEnd = async (event: DragEndEvent): Promise<void> => {
		const over = event.over;
		if (!over) return;
		const targetStatus = String(over.id).replace(/^column:/, "");
		const taskId = String(event.active.id);
		const task = tasks.find((t) => t.id === taskId);
		if (!task || task.status === targetStatus) return;

		const previous = tasks;
		setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t)));
		try {
			await api.move(taskId, targetStatus);
		} catch (error) {
			setTasks(previous);
			setToast({ message: (error as Error).message, kind: "error" });
			window.setTimeout(() => setToast(null), 4000);
		}
	};

	const handleCreate = async (title: string): Promise<void> => {
		try {
			const created = await api.create({ title });
			setTasks((prev) => [...prev, created]);
			setToast({ message: `Created ${created.id}`, kind: "info" });
		} catch (error) {
			setToast({ message: (error as Error).message, kind: "error" });
		}
		setShowCreate(false);
		window.setTimeout(() => setToast(null), 2500);
	};

	return (
		<div className="app">
			<div className="topbar">
				<h1>ordna</h1>
				<span className="meta">{config?.tasksDir ?? ""}</span>
				<div className="spacer" />
				<input
					placeholder="Search…"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
				<button type="button" className="primary" onClick={() => setShowCreate(true)}>
					+ New task
				</button>
			</div>

			<DndContext sensors={sensors} onDragEnd={onDragEnd}>
				<div className="board">
					{statuses.map((status) => (
						<Column key={status} status={status} tasks={groups[status] ?? []} />
					))}
				</div>
			</DndContext>

			{showCreate ? (
				<CreateModal onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
			) : null}

			{toast ? (
				<div className={`toast ${toast.kind === "error" ? "error" : ""}`}>{toast.message}</div>
			) : null}
		</div>
	);
}

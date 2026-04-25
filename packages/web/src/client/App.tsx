import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentHookInfo, UiConfig, WireTask, WsEvent } from "../shared/types.js";
import { api } from "./api.js";
import { Card } from "./Card.js";
import { Cheatsheet } from "./Cheatsheet.js";
import { Column, colorForStatus } from "./Column.js";
import { CommandPalette, type PaletteAction } from "./CommandPalette.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { CreateModal } from "./CreateModal.js";
import { Icon } from "./icons.js";
import { TaskModal } from "./TaskModal.js";

type Theme = "dark" | "light";
type View =
	| { kind: "all" }
	| { kind: "status"; status: string }
	| { kind: "tag"; tag: string }
	| { kind: "archived" };
type PriorityFilter = "high" | "medium" | "low" | null;

const ARCHIVED_STATUS = "archived";

function groupBy(tasks: WireTask[], statuses: string[]): Record<string, WireTask[]> {
	const groups: Record<string, WireTask[]> = {};
	for (const s of statuses) groups[s] = [];
	for (const t of tasks) (groups[t.status] ??= []).push(t);
	return groups;
}

function loadTheme(): Theme {
	const stored = window.localStorage.getItem("ordna-theme");
	if (stored === "light" || stored === "dark") return stored;
	return "dark";
}

export function App(): JSX.Element {
	const [config, setConfig] = useState<UiConfig | null>(null);
	const [tasks, setTasks] = useState<WireTask[]>([]);
	const [query, setQuery] = useState("");
	const [toast, setToast] = useState<{ message: string; kind: "info" | "error" } | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [openInEdit, setOpenInEdit] = useState<boolean>(false);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [theme, setTheme] = useState<Theme>(loadTheme);
	const [view, setView] = useState<View>({ kind: "all" });
	const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [cheatOpen, setCheatOpen] = useState(false);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		window.localStorage.setItem("ordna-theme", theme);
	}, [theme]);

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

	const toggleTheme = useCallback(() => {
		setTheme((t) => (t === "dark" ? "light" : "dark"));
	}, []);

	const createAt = useCallback(
		async (status?: string) => {
			if (!status) {
				setShowCreate(true);
				return;
			}
			try {
				const t = await api.create({ title: "New task" });
				setTasks((prev) => [...prev, t]);
				setOpenTaskId(t.id);
				setOpenInEdit(true);
			} catch (e) {
				setToast({ message: (e as Error).message, kind: "error" });
				window.setTimeout(() => setToast(null), 4000);
			}
		},
		[],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			const target = e.target as HTMLElement | null;
			const inField =
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT" ||
					target.isContentEditable);

			const mod = e.metaKey || e.ctrlKey;
			if (mod && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setPaletteOpen((p) => !p);
				return;
			}
			if (inField) return;
			if (e.key === "/") {
				e.preventDefault();
				document.getElementById("topbar-search")?.focus();
			} else if (e.key === "n") {
				e.preventDefault();
				setShowCreate(true);
			} else if (e.key === "t") {
				e.preventDefault();
				toggleTheme();
			} else if (e.key === "?") {
				e.preventDefault();
				setCheatOpen((c) => !c);
			} else if (e.key === "Escape") {
				if (paletteOpen) setPaletteOpen(false);
				else if (cheatOpen) setCheatOpen(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [paletteOpen, cheatOpen, toggleTheme]);

	const filtered = useMemo<WireTask[]>(() => {
		const q = query.trim().toLowerCase();
		return tasks.filter((t) => {
			const isArchived = t.status === ARCHIVED_STATUS;
			if (view.kind === "archived") {
				if (!isArchived) return false;
			} else {
				if (isArchived) return false;
				if (view.kind === "status" && t.status !== view.status) return false;
				if (view.kind === "tag" && !t.tags.includes(view.tag)) return false;
			}
			if (priorityFilter && t.priority !== priorityFilter) return false;
			if (!q) return true;
			return (
				t.title.toLowerCase().includes(q) ||
				t.id.toLowerCase().includes(q) ||
				t.tags.some((tag) => tag.toLowerCase().includes(q))
			);
		});
	}, [tasks, view, priorityFilter, query]);

	const boardStatuses = view.kind === "archived" ? [ARCHIVED_STATUS] : statuses;
	const groups = useMemo(
		() => groupBy(filtered, boardStatuses),
		[filtered, boardStatuses],
	);
	const tagList = useMemo(() => {
		const counts = new Map<string, number>();
		for (const t of tasks) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
	}, [tasks]);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor),
	);

	const onDragStart = (event: DragStartEvent): void => {
		setActiveId(String(event.active.id));
	};

	const onDragEnd = async (event: DragEndEvent): Promise<void> => {
		setActiveId(null);
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

	const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

	const agentHook: AgentHookInfo | null = config?.agentHook ?? null;

	const handleAgent = useCallback(
		async (id: string): Promise<void> => {
			if (!agentHook?.enabled) return;
			try {
				await api.agent(id);
				setToast({ message: `Sent ${id} to ${agentHook.label}`, kind: "info" });
			} catch (error) {
				setToast({ message: (error as Error).message, kind: "error" });
			}
			window.setTimeout(() => setToast(null), 3000);
		},
		[agentHook],
	);

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

	const activeTasks = useMemo(
		() => tasks.filter((t) => t.status !== ARCHIVED_STATUS),
		[tasks],
	);
	const archivedCount = tasks.length - activeTasks.length;
	const statusCounts = useMemo(() => {
		const c: Record<string, number> = {};
		for (const s of statuses) c[s] = 0;
		for (const t of activeTasks) c[t.status] = (c[t.status] ?? 0) + 1;
		return c;
	}, [activeTasks, statuses]);

	const paletteActions: PaletteAction[] = [
		{ id: "new", label: "New task", hint: "N", icon: "Plus", run: () => setShowCreate(true) },
		{
			id: "theme",
			label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
			hint: "T",
			icon: theme === "dark" ? "Sun" : "Moon",
			run: toggleTheme,
		},
		{
			id: "shortcuts",
			label: "Show shortcuts",
			hint: "?",
			icon: "Command",
			run: () => setCheatOpen(true),
		},
		{
			id: "all",
			label: "View all tasks",
			icon: "Inbox",
			run: () => setView({ kind: "all" }),
		},
	];

	return (
		<div className="app">
			<div className="topbar">
				<div className="brand">
					<span className="brand-logo">O</span>
					<span>Ordna</span>
				</div>
				{config ? (
					<div className="crumbs">
						<span className="sep">/</span>
						<span className="active">{config.tasksDir}</span>
					</div>
				) : null}
				<div className="topbar-spacer" />
				<div className="search" style={{ width: 320, height: 34 }}>
					<Icon.Search />
					<input
						id="topbar-search"
						placeholder="Search…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<span className="kbd">/</span>
				</div>
				<button
					type="button"
					className="btn-icon"
					title="Shortcuts (?)"
					onClick={() => setCheatOpen((c) => !c)}
				>
					<Icon.Command />
				</button>
				<button
					type="button"
					className="btn-icon"
					title={theme === "dark" ? "Switch to light (T)" : "Switch to dark (T)"}
					onClick={toggleTheme}
				>
					{theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
				</button>
				<button
					type="button"
					className="btn btn-primary"
					onClick={() => setShowCreate(true)}
				>
					<Icon.Plus /> New task <span className="kbd">N</span>
				</button>
			</div>

			<div className="main">
				<div className="sidebar">
					<div className="side-head">Views</div>
					<button
						type="button"
						className={`side-item ${view.kind === "all" ? "active" : ""}`}
						onClick={() => setView({ kind: "all" })}
					>
						<Icon.Inbox /> All tasks
						<span className="count">{activeTasks.length}</span>
					</button>
					{statuses.map((s, idx) => (
						<button
							key={s}
							type="button"
							className={`side-item ${view.kind === "status" && view.status === s ? "active" : ""}`}
							onClick={() => setView({ kind: "status", status: s })}
						>
							<span className={`side-dot col-dot ${colorForStatus(s, idx)}`} />
							{s}
							<span className="count">{statusCounts[s] ?? 0}</span>
						</button>
					))}
					<button
						type="button"
						className={`side-item ${view.kind === "archived" ? "active" : ""}`}
						onClick={() => setView({ kind: "archived" })}
					>
						<span className="side-dot col-dot" style={{ background: "var(--text-4)" }} />
						archived
						<span className="count">{archivedCount}</span>
					</button>
					<div className="side-divider" />
					<div className="side-head">Priority</div>
					{(["high", "medium", "low"] as const).map((p) => (
						<button
							key={p}
							type="button"
							className={`side-item ${priorityFilter === p ? "active" : ""}`}
							onClick={() => setPriorityFilter((cur) => (cur === p ? null : p))}
						>
							<span className={`side-dot col-dot`} style={{ background: `var(--prio-${p === "medium" ? "med" : p})` }} />
							{p}
							<span className="count">{tasks.filter((t) => t.priority === p).length}</span>
						</button>
					))}
					{tagList.length > 0 ? (
						<>
							<div className="side-divider" />
							<div className="side-head">Tags</div>
							{tagList.map(([tag, count]) => (
								<button
									key={tag}
									type="button"
									className={`side-item ${view.kind === "tag" && view.tag === tag ? "active" : ""}`}
									onClick={() => setView({ kind: "tag", tag })}
								>
									<Icon.Hash />
									{tag}
									<span className="count">{count}</span>
								</button>
							))}
						</>
					) : null}
				</div>

				<div className="boardwrap">
					<div className="subbar">
						<h1>
							{view.kind === "all"
								? "All tasks"
								: view.kind === "archived"
									? "Archived"
									: view.kind === "status"
										? view.status
										: `#${view.tag}`}
						</h1>
						<span className="meta">
							· {filtered.length} visible · {activeTasks.length} total
						</span>
						<div className="subbar-spacer" />
						{priorityFilter ? (
							<button
								type="button"
								className="pill active"
								onClick={() => setPriorityFilter(null)}
							>
								<span className={`prio-dot ${priorityFilter}`} /> {priorityFilter}
								<Icon.X />
							</button>
						) : null}
					</div>

					<DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
						<div className="board">
							{(view.kind === "archived" ? [ARCHIVED_STATUS] : statuses).map((status, idx) => (
								<Column
									key={status}
									status={status}
									color={view.kind === "archived" ? "slate" : colorForStatus(status, idx)}
									tasks={groups[status] ?? []}
									onSelect={(id) => {
										setOpenTaskId(id);
										setOpenInEdit(false);
									}}
									onEdit={(id) => {
										setOpenTaskId(id);
										setOpenInEdit(true);
									}}
									onDelete={(id) => setConfirmDeleteId(id)}
									agentHook={agentHook}
									onAgent={handleAgent}
								/>
							))}
						</div>
						<DragOverlay dropAnimation={null}>
							{activeTask ? <Card task={activeTask} overlay /> : null}
						</DragOverlay>
					</DndContext>
				</div>
			</div>

			{showCreate ? (
				<CreateModal onSubmit={handleCreate} onCancel={() => setShowCreate(false)} />
			) : null}

			{openTaskId && config
				? (() => {
						const open = tasks.find((t) => t.id === openTaskId);
						if (!open) return null;
						return (
							<TaskModal
								task={open}
								config={config}
								startInEdit={openInEdit}
								onClose={() => {
									setOpenTaskId(null);
									setOpenInEdit(false);
								}}
								onSaved={(updated) => {
									setTasks((prev) =>
										prev.map((t) => (t.id === updated.id ? updated : t)),
									);
								}}
								onDelete={(id) => {
									setOpenTaskId(null);
									setOpenInEdit(false);
									setConfirmDeleteId(id);
								}}
								agentHook={agentHook}
								onAgent={handleAgent}
							/>
						);
					})()
				: null}

			{confirmDeleteId ? (
				<ConfirmDialog
					title="Delete task?"
					message={`This will remove ${confirmDeleteId} from disk. Make a commit first if you want to keep a record.`}
					confirmLabel="Delete"
					danger
					onCancel={() => setConfirmDeleteId(null)}
					onConfirm={async () => {
						const id = confirmDeleteId;
						setConfirmDeleteId(null);
						try {
							await api.remove(id);
							setTasks((prev) => prev.filter((t) => t.id !== id));
							setToast({ message: `Deleted ${id}`, kind: "info" });
							window.setTimeout(() => setToast(null), 2500);
						} catch (error) {
							setToast({ message: (error as Error).message, kind: "error" });
							window.setTimeout(() => setToast(null), 4000);
						}
					}}
				/>
			) : null}

			{paletteOpen ? (
				<CommandPalette
					tasks={tasks}
					actions={paletteActions}
					onOpenTask={(id) => {
						setOpenTaskId(id);
						setOpenInEdit(false);
					}}
					onClose={() => setPaletteOpen(false)}
				/>
			) : null}

			{cheatOpen ? <Cheatsheet onClose={() => setCheatOpen(false)} /> : null}

			{toast ? (
				<div className={`toast ${toast.kind === "error" ? "error" : ""}`}>{toast.message}</div>
			) : null}
		</div>
	);
}

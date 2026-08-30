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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentHookInfo, UiConfig, WireTask, WsEvent } from "../shared/types.js";
import { Card } from "./Card.js";
import { Cheatsheet } from "./Cheatsheet.js";
import { Column, colorForStatus } from "./Column.js";
import { CommandPalette, type PaletteAction } from "./CommandPalette.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { CreateModal } from "./CreateModal.js";
import { TaskModal } from "./TaskModal.js";
import { api } from "./api.js";
import { Avatar, Icon } from "./icons.js";

type Theme = "dark" | "light";
type View =
	| { kind: "all" }
	| { kind: "status"; status: string }
	| { kind: "tag"; tag: string }
	| { kind: "archived" };
type PriorityFilter = "high" | "medium" | "low" | null;

const ARCHIVED_STATUS = "archived";

/**
 * Insert-or-replace a task by id. Create responses race with the
 * watcher's WebSocket `added` event (whichever lands first), so every
 * path that adds a task to state must be idempotent — a blind append
 * briefly shows the same task twice until a reload.
 */
function upsertTask(prev: WireTask[], task: WireTask): WireTask[] {
	const next = prev.filter((t) => t.id !== task.id);
	next.push(task);
	return next;
}

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

type Density = "comfortable" | "compact";

function loadDensity(): Density {
	const stored = window.localStorage.getItem("ordna-density");
	if (stored === "compact" || stored === "comfortable") return stored;
	return "comfortable";
}

export function App(): JSX.Element {
	const [config, setConfig] = useState<UiConfig | null>(null);
	const [tasks, setTasks] = useState<WireTask[]>([]);
	const [query, setQuery] = useState("");
	const [toast, setToast] = useState<{ message: string; kind: "info" | "error" } | null>(null);
	// One timer for the visible toast: replacing a toast cancels the old
	// timer so a short-lived info timeout can't dismiss a newer error.
	// Errors stay >= 20s (they carry recovery instructions); info ~3s.
	const toastTimer = useRef<number | null>(null);
	const showToast = useCallback((message: string, kind: "info" | "error" = "info") => {
		setToast({ message, kind });
		if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
		toastTimer.current = window.setTimeout(() => setToast(null), kind === "error" ? 20000 : 3000);
	}, []);
	const [showCreate, setShowCreate] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [openTaskId, setOpenTaskId] = useState<string | null>(null);
	const [openInEdit, setOpenInEdit] = useState<boolean>(false);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
	const [theme, setTheme] = useState<Theme>(loadTheme);
	const [density, setDensity] = useState<Density>(loadDensity);
	const [view, setView] = useState<View>({ kind: "all" });
	const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>(null);
	// Assignee filter: a name, "" for unassigned, or null (off).
	const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [cheatOpen, setCheatOpen] = useState(false);
	const [isFetching, setIsFetching] = useState(false);
	// Sidebar fold state. `foldable` = the window is narrow enough that
	// the filter panel has detached into a floating overlay (engaged
	// ~2s after the window drops to <= 980px). `sidebarRevealed` = the
	// floating panel is currently slid in over the board.
	const [foldable, setFoldable] = useState(false);
	const [sidebarRevealed, setSidebarRevealed] = useState(false);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		window.localStorage.setItem("ordna-theme", theme);
	}, [theme]);

	useEffect(() => {
		window.localStorage.setItem("ordna-density", density);
	}, [density]);

	const compact = density === "compact";
	const toggleDensity = useCallback(() => {
		setDensity((d) => (d === "compact" ? "comfortable" : "compact"));
	}, []);

	useEffect(() => {
		void (async () => {
			const [cfg, list] = await Promise.all([api.config(), api.list()]);
			setConfig(cfg);
			setTasks(list);
		})();
	}, []);

	// Live updates over WebSocket — with reconnection and gap recovery.
	// The socket dies silently all the time in practice (laptop sleep,
	// backgrounded tabs, server restarts), and the server has no event
	// replay, so recovery is two-part: reconnect with a short retry, and
	// re-fetch the full list on every (re)open plus whenever the tab
	// becomes visible or the network comes back. Without this the board
	// silently freezes while still looking alive.
	useEffect(() => {
		let ws: WebSocket | null = null;
		let disposed = false;
		let retryTimer: number | null = null;

		const resync = async (): Promise<void> => {
			try {
				const list = await api.list();
				if (!disposed) setTasks(list);
			} catch {
				// Server unreachable right now — the reconnect loop keeps trying.
			}
		};

		const connect = (): void => {
			if (disposed) return;
			const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
			ws = new WebSocket(`${proto}//${window.location.host}/ws`);
			ws.onopen = () => {
				// Catch up on anything that happened while disconnected.
				void resync();
			};
			ws.onmessage = (event) => {
				const evt = JSON.parse(event.data) as WsEvent;
				setTasks((prev) => {
					if (evt.type === "removed") return prev.filter((t) => t.id !== evt.id);
					if (evt.type === "renamed") {
						// Drop the old-id entry and re-insert under newId.
						const next = prev.filter((t) => t.id !== evt.oldId && t.id !== evt.newId);
						next.push(evt.task);
						return next;
					}
					const next = prev.filter((t) => t.id !== evt.task.id);
					next.push(evt.task);
					return next;
				});
				if (evt.type === "renamed") {
					// If the user has the renamed task open, swap to its new id so
					// the modal stays on the same content.
					setOpenTaskId((cur) => (cur === evt.oldId ? evt.newId : cur));
					setActiveId((cur) => (cur === evt.oldId ? evt.newId : cur));
					showToast(`Renamed ${evt.oldId} → ${evt.newId}`);
				}
			};
			ws.onclose = () => {
				if (disposed) return;
				retryTimer = window.setTimeout(connect, 1500);
			};
		};
		connect();

		// A sleeping tab's socket often dies without a close event firing
		// until much later — when the user comes back (or the network
		// returns), resync immediately and revive the socket if needed.
		const ensureLive = (): void => {
			if (disposed) return;
			if (ws && ws.readyState === WebSocket.OPEN) {
				void resync();
				return;
			}
			if (ws && ws.readyState === WebSocket.CONNECTING) return;
			if (retryTimer !== null) {
				window.clearTimeout(retryTimer);
				retryTimer = null;
			}
			connect(); // onopen resyncs
		};
		const onVisible = (): void => {
			if (document.visibilityState === "visible") ensureLive();
		};
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("online", ensureLive);
		window.addEventListener("focus", onVisible);

		return () => {
			disposed = true;
			if (retryTimer !== null) window.clearTimeout(retryTimer);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("online", ensureLive);
			window.removeEventListener("focus", onVisible);
			ws?.close();
		};
	}, [showToast]);

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
				setTasks((prev) => upsertTask(prev, t));
				setOpenTaskId(t.id);
				setOpenInEdit(true);
			} catch (e) {
				showToast((e as Error).message, "error");
			}
		},
		[showToast],
	);

	const runFetch = useCallback(async () => {
		if (isFetching) return;
		setIsFetching(true);
		try {
			const result = await api.fetchRemote();
			const refs = result.refsUpdated;
			const msg =
				refs === 0
					? `Up to date · ${result.durationMs}ms`
					: `Fetched ${refs} ref${refs === 1 ? "" : "s"} · ${result.durationMs}ms`;
			showToast(msg);
		} catch (e) {
			showToast((e as Error).message, "error");
		} finally {
			setIsFetching(false);
		}
	}, [isFetching, showToast]);

	// Detach the sidebar into a floating panel when the window is narrow.
	// Crossing to <= 980px starts a 2s grace timer before folding (so a
	// transient resize doesn't yank the panel); widening back cancels it
	// and re-docks immediately.
	useEffect(() => {
		const NARROW_PX = 980;
		const FOLD_DELAY_MS = 2000;
		let foldTimer: ReturnType<typeof setTimeout> | null = null;
		let isFoldable = false;

		const apply = (): void => {
			const narrow = window.innerWidth <= NARROW_PX;
			if (narrow) {
				if (!isFoldable && foldTimer === null) {
					foldTimer = setTimeout(() => {
						foldTimer = null;
						isFoldable = true;
						setFoldable(true);
					}, FOLD_DELAY_MS);
				}
			} else {
				if (foldTimer) {
					clearTimeout(foldTimer);
					foldTimer = null;
				}
				if (isFoldable) {
					isFoldable = false;
					setFoldable(false);
				}
				setSidebarRevealed(false);
			}
		};

		apply();
		window.addEventListener("resize", apply);
		return () => {
			window.removeEventListener("resize", apply);
			if (foldTimer) clearTimeout(foldTimer);
		};
	}, []);

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
			} else if (e.key === "r" && config?.capabilities?.fetch) {
				e.preventDefault();
				void runFetch();
			} else if (e.key === "Escape") {
				if (paletteOpen) setPaletteOpen(false);
				else if (cheatOpen) setCheatOpen(false);
				else if (sidebarRevealed) setSidebarRevealed(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [paletteOpen, cheatOpen, sidebarRevealed, toggleTheme, config?.capabilities?.fetch, runFetch]);

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
			if (assigneeFilter !== null && (t.assignee ?? "") !== assigneeFilter) return false;
			if (!q) return true;
			return (
				t.title.toLowerCase().includes(q) ||
				t.id.toLowerCase().includes(q) ||
				t.tags.some((tag) => tag.toLowerCase().includes(q))
			);
		});
	}, [tasks, view, priorityFilter, assigneeFilter, query]);

	const boardStatuses = view.kind === "archived" ? [ARCHIVED_STATUS] : statuses;
	const groups = useMemo(() => groupBy(filtered, boardStatuses), [filtered, boardStatuses]);
	const assigneeList = useMemo(() => {
		const counts = new Map<string, number>();
		for (const t of tasks) {
			if (t.status === ARCHIVED_STATUS) continue;
			const key = t.assignee ?? "";
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		// Named assignees by count; "unassigned" ("" key) always last.
		const named = [...counts.entries()].filter(([n]) => n !== "").sort((a, b) => b[1] - a[1]);
		const unassigned = counts.get("");
		if (unassigned) named.push(["", unassigned]);
		return named;
	}, [tasks]);

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
			showToast((error as Error).message, "error");
		}
	};

	const activeTask = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;

	const agentHook: AgentHookInfo | null = config?.agentHook ?? null;

	const handleAgent = useCallback(
		async (id: string): Promise<void> => {
			if (!agentHook?.enabled) return;
			try {
				await api.agent(id);
				showToast(`Sent ${id} to ${agentHook.label}`);
			} catch (error) {
				showToast((error as Error).message, "error");
			}
		},
		[agentHook, showToast],
	);

	const handleCreate = async (title: string): Promise<void> => {
		try {
			const created = await api.create({ title });
			setTasks((prev) => upsertTask(prev, created));
			showToast(`Created ${created.id}`);
		} catch (error) {
			showToast((error as Error).message, "error");
		}
		setShowCreate(false);
	};

	const activeTasks = useMemo(() => tasks.filter((t) => t.status !== ARCHIVED_STATUS), [tasks]);
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
			id: "density",
			label: compact ? "Comfortable cards" : "Compact cards",
			icon: compact ? "Expand" : "Compress",
			run: toggleDensity,
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
		<div className={`app${compact ? " compact" : ""}`}>
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
				<div className="search" style={{ flex: "0 1 320px", minWidth: 110, height: 34 }}>
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
					title={compact ? "Comfortable cards" : "Compact cards"}
					onClick={toggleDensity}
				>
					{compact ? <Icon.Expand /> : <Icon.Compress />}
				</button>
				<button
					type="button"
					className="btn-icon"
					title={theme === "dark" ? "Switch to light (T)" : "Switch to dark (T)"}
					onClick={toggleTheme}
				>
					{theme === "dark" ? <Icon.Sun /> : <Icon.Moon />}
				</button>
				{config?.capabilities?.fetch ? (
					<button
						type="button"
						className="btn-icon"
						title="Fetch updates from remote (R)"
						disabled={isFetching}
						onClick={runFetch}
					>
						<Icon.Refresh />
					</button>
				) : null}
				<button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
					<Icon.Plus /> New task <span className="kbd">N</span>
				</button>
			</div>

			<div
				className={`main${foldable ? " sidebar-foldable" : ""}${
					foldable && sidebarRevealed ? " sidebar-revealed" : ""
				}`}
			>
				{foldable ? (
					<button
						type="button"
						className="sidebar-hotzone"
						aria-label="Show filters"
						aria-expanded={sidebarRevealed}
						onMouseEnter={() => setSidebarRevealed(true)}
						onFocus={() => setSidebarRevealed(true)}
						onClick={() => setSidebarRevealed(true)}
					/>
				) : null}
				{foldable && sidebarRevealed ? (
					<button
						type="button"
						className="sidebar-scrim"
						aria-label="Close filters"
						tabIndex={-1}
						onClick={() => setSidebarRevealed(false)}
					/>
				) : null}
				<div
					className="sidebar"
					onMouseLeave={() => {
						if (foldable) setSidebarRevealed(false);
					}}
				>
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
							<span
								className={`side-dot col-dot`}
								style={{ background: `var(--prio-${p === "medium" ? "med" : p})` }}
							/>
							{p}
							<span className="count">{tasks.filter((t) => t.priority === p).length}</span>
						</button>
					))}
					{assigneeList.length > 0 ? (
						<>
							<div className="side-divider" />
							<div className="side-head">People</div>
							{assigneeList.map(([name, count]) => (
								<button
									key={name || "<unassigned>"}
									type="button"
									className={`side-item ${assigneeFilter === name ? "active" : ""}`}
									onClick={() => setAssigneeFilter((cur) => (cur === name ? null : name))}
								>
									<Avatar name={name || null} size={16} />
									{name || "unassigned"}
									<span className="count">{count}</span>
								</button>
							))}
						</>
					) : null}
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
							<button type="button" className="pill active" onClick={() => setPriorityFilter(null)}>
								<span className={`prio-dot ${priorityFilter}`} /> {priorityFilter}
								<Icon.X />
							</button>
						) : null}
						{assigneeFilter !== null ? (
							<button type="button" className="pill active" onClick={() => setAssigneeFilter(null)}>
								<Avatar name={assigneeFilter || null} size={14} /> {assigneeFilter || "unassigned"}
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
									compact={compact}
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
							{activeTask ? <Card task={activeTask} overlay compact={compact} /> : null}
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
								canAttach={config.capabilities?.attach ?? false}
								onClose={() => {
									setOpenTaskId(null);
									setOpenInEdit(false);
								}}
								onSaved={(updated) => {
									setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
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
							showToast(`Deleted ${id}`);
						} catch (error) {
							showToast((error as Error).message, "error");
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
				<button
					type="button"
					className={`toast ${toast.kind === "error" ? "error" : ""}`}
					title="Dismiss"
					onClick={() => setToast(null)}
				>
					{toast.message}
				</button>
			) : null}
		</div>
	);
}

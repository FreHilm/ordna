import { spawn } from "node:child_process";
import {
	ARCHIVED_STATUS,
	createContext as createStoreContext,
	createTask,
	listTasks,
	moveTask,
	updateTask,
	watchTasks,
	type StoreContext,
	type Task,
} from "@frehilm/ordna-core";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { type AgentHookConfig, loadAgentHook, sendAgent } from "../agent.js";
import { Column } from "./Column.js";
import { useTerminalSize } from "./hooks.js";
import { SelectPrompt } from "./SelectPrompt.js";
import {
	Sidebar,
	buildSidebarRows,
	matchesFilter,
	rowKey,
	type SidebarItem,
	type SidebarRow,
} from "./Sidebar.js";
import { Subbar } from "./Subbar.js";
import { TaskDetail } from "./TaskDetail.js";
import { TaskEditor } from "./TaskEditor.js";
import { TextPrompt } from "./TextPrompt.js";
import { theme } from "./theme.js";

type Mode =
	| { kind: "browse" }
	| { kind: "detail"; task: Task }
	| { kind: "edit"; task: Task; returnTo: "browse" | "detail" }
	| { kind: "create" }
	| { kind: "assign"; task: Task }
	| { kind: "move"; task: Task }
	| { kind: "search" };

type Focus = "board" | "sidebar";

const SIDEBAR_WIDTH = 22;

function groupByStatus(tasks: Task[], statuses: string[]): Map<string, Task[]> {
	const groups = new Map<string, Task[]>();
	for (const status of statuses) groups.set(status, []);
	for (const task of tasks) {
		const bucket = groups.get(task.status);
		if (bucket) bucket.push(task);
	}
	return groups;
}

function flattenSidebarRows(rows: ReturnType<typeof buildSidebarRows>): SidebarRow[] {
	return [...rows.views, ...rows.priorities, ...rows.tags];
}

export interface AppProps {
	agentHook?: AgentHookConfig | null;
}

export function App({ agentHook: agentHookProp }: AppProps = {}): React.JSX.Element {
	const { exit } = useApp();
	const { setRawMode } = useStdin();
	const { rows: termRows, columns: termCols } = useTerminalSize();
	const [ctx] = useState<StoreContext>(() => createStoreContext());
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [columnIndex, setColumnIndex] = useState(0);
	const [rowIndex, setRowIndex] = useState(0);
	const [mode, setMode] = useState<Mode>({ kind: "browse" });
	const [searchQuery, setSearchQuery] = useState("");
	const [toast, setToast] = useState<string | null>(null);
	const [grabbedId, setGrabbedId] = useState<string | null>(null);
	const [filter, setFilter] = useState<SidebarItem>({ kind: "all" });
	const [focus, setFocus] = useState<Focus>("board");
	const [sidebarFocusedKey, setSidebarFocusedKey] = useState<string | null>(null);
	const [scrollOffsets, setScrollOffsets] = useState<Record<string, number>>({});
	const [agentHook] = useState<AgentHookConfig | null>(() => {
		if (agentHookProp !== undefined) return agentHookProp;
		return loadAgentHook();
	});

	const statuses = ctx.config.statuses;

	const reload = useCallback(async (): Promise<void> => {
		const fresh = await listTasks(ctx);
		setTasks(fresh);
		setLoaded(true);
	}, [ctx]);

	useEffect(() => {
		void reload();
		const unsubscribe = watchTasks(ctx, () => {
			void reload();
		});
		return () => {
			void unsubscribe();
		};
	}, [ctx, reload]);

	const sidebarRows = useMemo(() => buildSidebarRows(tasks, statuses), [tasks, statuses]);
	const flatRows = useMemo(() => flattenSidebarRows(sidebarRows), [sidebarRows]);

	useEffect(() => {
		if (focus !== "sidebar") return;
		if (sidebarFocusedKey === null && flatRows.length > 0) {
			const active = flatRows.find((r) => rowKey(r.item) === rowKey(filter));
			setSidebarFocusedKey(rowKey(active?.item ?? flatRows[0]?.item ?? { kind: "all" }));
		}
	}, [focus, flatRows, sidebarFocusedKey, filter]);

	const showingBoardColumns = filter.kind !== "archived";
	const boardStatuses = useMemo(() => {
		if (filter.kind === "archived") return [ARCHIVED_STATUS];
		if (filter.kind === "status") return [filter.status];
		return statuses;
	}, [filter, statuses]);

	const filteredTasks = useMemo<Task[]>(() => {
		const q = searchQuery.toLowerCase();
		return tasks.filter((t) => {
			if (!matchesFilter(t, filter)) return false;
			if (!q) return true;
			return (
				t.title.toLowerCase().includes(q) ||
				t.id.toLowerCase().includes(q) ||
				t.tags.some((tag) => tag.toLowerCase().includes(q))
			);
		});
	}, [tasks, filter, searchQuery]);

	const groups = useMemo(
		() => groupByStatus(filteredTasks, boardStatuses),
		[filteredTasks, boardStatuses],
	);

	const activeStatus = boardStatuses[columnIndex] ?? boardStatuses[0] ?? "";
	const activeColumn = groups.get(activeStatus) ?? [];
	const selectedTask: Task | undefined = activeColumn[rowIndex];

	useEffect(() => {
		if (columnIndex >= boardStatuses.length) setColumnIndex(0);
	}, [boardStatuses.length, columnIndex]);

	useEffect(() => {
		if (rowIndex >= activeColumn.length) {
			setRowIndex(Math.max(0, activeColumn.length - 1));
		}
	}, [activeColumn.length, rowIndex]);

	const visibleCount = filteredTasks.length;
	const totalCount = useMemo(
		() => tasks.filter((t) => t.status !== ARCHIVED_STATUS).length,
		[tasks],
	);

	const launchEditor = useCallback(
		(task: Task) => {
			const editor = process.env.EDITOR || process.env.VISUAL || "vi";
			setRawMode?.(false);
			const proc = spawn(editor, [task.filePath], { stdio: "inherit" });
			proc.on("exit", () => {
				setRawMode?.(true);
				void reload();
			});
		},
		[reload, setRawMode],
	);

	const flashToast = (message: string): void => {
		setToast(message);
		setTimeout(() => setToast((t) => (t === message ? null : t)), 2500);
	};

	const moveGrabbedTo = async (targetIndex: number): Promise<void> => {
		if (grabbedId === null) return;
		const targetStatus = boardStatuses[targetIndex];
		if (!targetStatus) return;
		const task = tasks.find((t) => t.id === grabbedId);
		if (!task || task.status === targetStatus) {
			setColumnIndex(targetIndex);
			return;
		}
		try {
			await moveTask(grabbedId, targetStatus, ctx);
			await reload();
			setColumnIndex(targetIndex);
			const fresh = await listTasks(ctx);
			const group = fresh.filter((t) => t.status === targetStatus);
			const nextIdx = group.findIndex((t) => t.id === grabbedId);
			const clampedIdx = Math.max(0, nextIdx);
			setRowIndex(clampedIdx);
			ensureRowVisible(targetStatus, clampedIdx, group);
		} catch (error) {
			flashToast((error as Error).message);
		}
	};

	const archiveSelected = async (task: Task): Promise<void> => {
		try {
			await updateTask(task.id, { status: ARCHIVED_STATUS }, ctx);
			flashToast(`${task.id} archived`);
			await reload();
		} catch (error) {
			flashToast((error as Error).message);
		}
	};

	const triggerAgent = async (task: Task): Promise<void> => {
		if (!agentHook) return;
		try {
			const result = await sendAgent(agentHook, task, {
				tasksDir: ctx.config.tasksDir,
				cwd: ctx.cwd,
				schema: ctx.config.schema,
			});
			if (!result.ok) {
				flashToast(`${agentHook.label} hook failed (${result.status})`);
				return;
			}
			flashToast(`Sent ${task.id} to ${agentHook.label}`);
		} catch (error) {
			flashToast((error as Error).message);
		}
	};

	const applySidebarFocused = (): void => {
		if (sidebarFocusedKey === null) return;
		const row = flatRows.find((r) => rowKey(r.item) === sidebarFocusedKey);
		if (row) {
			setFilter(row.item);
			setColumnIndex(0);
			setRowIndex(0);
			setFocus("board");
		}
	};

	useInput(
		async (input, key) => {
			if (mode.kind !== "browse") return;

			if (key.tab) {
				if (focus === "board") {
					setFocus("sidebar");
					setSidebarFocusedKey(rowKey(filter));
				} else {
					setFocus("board");
				}
				return;
			}

			if (focus === "sidebar") {
				if (key.escape) {
					setFocus("board");
					return;
				}
				if (key.upArrow || input === "k") {
					const idx = flatRows.findIndex((r) => rowKey(r.item) === sidebarFocusedKey);
					if (idx > 0) setSidebarFocusedKey(rowKey(flatRows[idx - 1]?.item ?? flatRows[0]?.item ?? { kind: "all" }));
					return;
				}
				if (key.downArrow || input === "j") {
					const idx = flatRows.findIndex((r) => rowKey(r.item) === sidebarFocusedKey);
					if (idx >= 0 && idx < flatRows.length - 1) {
						setSidebarFocusedKey(rowKey(flatRows[idx + 1]?.item ?? flatRows[0]?.item ?? { kind: "all" }));
					}
					return;
				}
				if (key.return) {
					applySidebarFocused();
					return;
				}
				if (input === "q") {
					exit();
				}
				return;
			}

			if (grabbedId !== null) {
				if (input === " " || key.return) {
					flashToast(`Dropped ${grabbedId}`);
					setGrabbedId(null);
					return;
				}
				if (key.escape) {
					setGrabbedId(null);
					return;
				}
				if (key.leftArrow || input === "h") {
					await moveGrabbedTo(Math.max(0, columnIndex - 1));
					return;
				}
				if (key.rightArrow || input === "l") {
					await moveGrabbedTo(Math.min(boardStatuses.length - 1, columnIndex + 1));
					return;
				}
				return;
			}

			if (input === "q") {
				exit();
				return;
			}
			if (key.leftArrow || input === "h") {
				setColumnIndex((i) => Math.max(0, i - 1));
				setRowIndex(0);
			} else if (key.rightArrow || input === "l") {
				setColumnIndex((i) => Math.min(boardStatuses.length - 1, i + 1));
				setRowIndex(0);
			} else if (key.upArrow || input === "k") {
				const nextRow = Math.max(0, rowIndex - 1);
				setRowIndex(nextRow);
				ensureRowVisible(activeStatus, nextRow, activeColumn);
			} else if (key.downArrow || input === "j") {
				const nextRow = Math.min(Math.max(0, activeColumn.length - 1), rowIndex + 1);
				setRowIndex(nextRow);
				ensureRowVisible(activeStatus, nextRow, activeColumn);
			} else if (input === " " && selectedTask) {
				setGrabbedId(selectedTask.id);
				flashToast(`Grabbed ${selectedTask.id} — ← → to move, space to drop`);
			} else if (key.return && selectedTask) {
				setMode({ kind: "detail", task: selectedTask });
			} else if (input === "c") {
				setMode({ kind: "create" });
			} else if (input === "m" && selectedTask) {
				setMode({ kind: "move", task: selectedTask });
			} else if (input === "a" && selectedTask) {
				setMode({ kind: "assign", task: selectedTask });
			} else if (input === "e" && selectedTask) {
				setMode({ kind: "edit", task: selectedTask, returnTo: "browse" });
			} else if (input === "E" && selectedTask) {
				launchEditor(selectedTask);
			} else if (input === "x" && selectedTask) {
				void archiveSelected(selectedTask);
			} else if (input === "g" && selectedTask && agentHook) {
				void triggerAgent(selectedTask);
			} else if (input === "/") {
				setMode({ kind: "search" });
			} else if (key.escape && searchQuery) {
				setSearchQuery("");
			}
		},
		{ isActive: mode.kind === "browse" },
	);

	const onCreate = async (title: string): Promise<void> => {
		try {
			const task = await createTask({ title }, ctx);
			flashToast(`Created ${task.id}`);
			await reload();
		} catch (error) {
			flashToast((error as Error).message);
		}
		setMode({ kind: "browse" });
	};

	const onMove = async (targetStatus: string): Promise<void> => {
		if (mode.kind !== "move") return;
		try {
			await moveTask(mode.task.id, targetStatus, ctx);
			flashToast(`${mode.task.id} → ${targetStatus}`);
			await reload();
			const fresh = await listTasks(ctx);
			const group = fresh.filter((t) => t.status === targetStatus);
			const nextIdx = group.findIndex((t) => t.id === mode.task.id);
			if (nextIdx >= 0) {
				const targetColIdx = boardStatuses.indexOf(targetStatus);
				if (targetColIdx >= 0) setColumnIndex(targetColIdx);
				setRowIndex(nextIdx);
				ensureRowVisible(targetStatus, nextIdx, group);
			}
		} catch (error) {
			flashToast((error as Error).message);
		}
		setMode({ kind: "browse" });
	};

	const onAssign = async (name: string): Promise<void> => {
		if (mode.kind !== "assign") return;
		try {
			const value = name.trim().length === 0 ? null : name.trim();
			await updateTask(mode.task.id, { assignee: value }, ctx);
			flashToast(`${mode.task.id} ${value ? `→ @${value}` : "unassigned"}`);
			await reload();
		} catch (error) {
			flashToast((error as Error).message);
		}
		setMode({ kind: "browse" });
	};

	const moveOptions = useMemo(
		() => [...statuses, ARCHIVED_STATUS],
		[statuses],
	);

	const sidebarWidth = SIDEBAR_WIDTH;
	const boardAreaWidth = Math.max(30, termCols - sidebarWidth);
	const subbarHeight = 1;
	const bodyHeight = Math.max(5, termRows - 3);
	const boardHeight = Math.max(5, bodyHeight - subbarHeight - 1);

	// Normal board column width = boardAreaWidth evenly split across configured statuses.
	// Archive view reuses this width (one column, same size as a regular lane).
	// Other views (all / status / tag) stretch columns to fill the board area evenly.
	const normalColCount = Math.max(1, statuses.length);
	const normalColWidth = Math.max(24, Math.floor(boardAreaWidth / normalColCount));
	const isArchive = filter.kind === "archived";
	const stretchedColCount = Math.max(1, boardStatuses.length);
	const stretchedColWidth = Math.max(24, Math.floor(boardAreaWidth / stretchedColCount));

	// Each column body has (boardHeight - 2) usable rows after title + bottom border.
	const columnBodyLines = Math.max(1, boardHeight - 2);

	const columnLayout = useCallback(
		(status: string, all: Task[]) => {
			const total = all.length;
			const needsScroll = total > columnBodyLines;
			// Reserve 1 row top + 1 row bottom for scroll indicators when needed.
			const visibleCount = needsScroll
				? Math.max(1, columnBodyLines - 2)
				: columnBodyLines;
			const maxOffset = Math.max(0, total - visibleCount);
			const storedOffset = scrollOffsets[status] ?? 0;
			const offset = Math.max(0, Math.min(maxOffset, storedOffset));
			const visible = all.slice(offset, offset + visibleCount);
			return {
				visible,
				offset,
				visibleCount,
				aboveCount: offset,
				belowCount: Math.max(0, total - offset - visibleCount),
				total,
			};
		},
		[columnBodyLines, scrollOffsets],
	);

	const ensureRowVisible = useCallback(
		(status: string, nextRow: number, all: Task[]): void => {
			const total = all.length;
			const needsScroll = total > columnBodyLines;
			const visibleCount = needsScroll
				? Math.max(1, columnBodyLines - 2)
				: columnBodyLines;
			setScrollOffsets((prev) => {
				const cur = prev[status] ?? 0;
				let next = cur;
				if (nextRow < cur) next = nextRow;
				else if (nextRow >= cur + visibleCount) next = nextRow - visibleCount + 1;
				const maxOffset = Math.max(0, total - visibleCount);
				next = Math.max(0, Math.min(maxOffset, next));
				if (next === cur) return prev;
				return { ...prev, [status]: next };
			});
		},
		[columnBodyLines],
	);

	const popupWidth = Math.min(boardAreaWidth - 4, Math.max(40, Math.floor(boardAreaWidth * 0.75)));
	const popupHeight = Math.min(boardHeight - 2, Math.max(10, Math.floor(boardHeight * 0.85)));

	const renderBoard = (): React.JSX.Element => (
		<Box flexDirection="row" height={boardHeight} width={boardAreaWidth}>
			{boardStatuses.map((s, idx) => {
				const all = groups.get(s) ?? [];
				const layout = columnLayout(s, all);
				const isFocusedCol = idx === columnIndex && mode.kind === "browse" && focus === "board";
				const selectedRelativeIndex = isFocusedCol
					? rowIndex - layout.offset
					: -1;
				let w: number;
				if (isArchive) {
					w = normalColWidth;
				} else if (idx === boardStatuses.length - 1) {
					w = boardAreaWidth - stretchedColWidth * (boardStatuses.length - 1);
				} else {
					w = stretchedColWidth;
				}
				return (
					<Column
						key={s}
						status={s}
						statusIndex={statuses.indexOf(s) >= 0 ? statuses.indexOf(s) : idx}
						visibleTasks={layout.visible}
						totalTasks={layout.total}
						aboveCount={layout.aboveCount}
						belowCount={layout.belowCount}
						focused={isFocusedCol}
						selectedRelativeIndex={selectedRelativeIndex}
						grabbedId={grabbedId}
						width={w}
						height={boardHeight}
					/>
				);
			})}
		</Box>
	);

	const renderOverlay = (): React.JSX.Element | null => {
		if (mode.kind === "create") {
			return (
				<TextPrompt
					label="New task title"
					onSubmit={onCreate}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			);
		}
		if (mode.kind === "move") {
			return (
				<SelectPrompt
					label={`Move ${mode.task.id} to…`}
					options={moveOptions}
					initialIndex={Math.max(0, moveOptions.indexOf(mode.task.status))}
					onSubmit={onMove}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			);
		}
		if (mode.kind === "assign") {
			return (
				<TextPrompt
					label={`Assign ${mode.task.id} (blank to unassign)`}
					initialValue={mode.task.assignee ?? ""}
					onSubmit={onAssign}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			);
		}
		if (mode.kind === "search") {
			return (
				<TextPrompt
					label="Search"
					initialValue={searchQuery}
					onSubmit={(v) => {
						setSearchQuery(v);
						setMode({ kind: "browse" });
					}}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			);
		}
		return null;
	};

	const overlay = renderOverlay();
	const showDetail = mode.kind === "detail";
	type Hint = { keys: string; label: string };
	const sidebarHints: Hint[] = [
		{ keys: "Tab", label: "board" },
		{ keys: "↑/↓", label: "select" },
		{ keys: "Enter", label: "apply" },
		{ keys: "Esc", label: "back" },
	];
	const grabHints: Hint[] = [
		{ keys: "←/→", label: "move" },
		{ keys: "Space", label: "drop" },
		{ keys: "Esc", label: "cancel" },
	];
	const browseHints: Hint[] = [
		{ keys: "Tab", label: "sidebar" },
		{ keys: "←/→", label: "cols" },
		{ keys: "↑/↓", label: "tasks" },
		{ keys: "Space", label: "grab" },
		{ keys: "Enter", label: "open" },
		{ keys: "c", label: "new" },
		{ keys: "m", label: "move" },
		{ keys: "a", label: "assign" },
		{ keys: "e", label: "edit" },
		{ keys: "E", label: "$EDITOR" },
		{ keys: "x", label: "archive" },
		...(agentHook ? [{ keys: "g", label: agentHook.label.toLowerCase() }] : []),
		{ keys: "/", label: "find" },
		{ keys: "q", label: "quit" },
	];
	const footerHints: Hint[] =
		focus === "sidebar" ? sidebarHints : grabbedId ? grabHints : browseHints;
	const footerPrefix =
		focus === "board" && grabbedId ? `moving ${grabbedId} · ` : null;

	return (
		<Box flexDirection="column" width={termCols} height={termRows}>
			<Box paddingX={1} width={termCols}>
				<Text bold color={theme.accent}>
					Ordna
				</Text>
				<Text color={theme.textMuted}>{`  ${ctx.tasksDir}`}</Text>
				<Box flexGrow={1} />
				{toast ? <Text color={theme.accent2}>{toast}</Text> : null}
			</Box>

			<Box width={termCols} height={1} />

			<Box flexDirection="row" width={termCols} height={bodyHeight}>
				<Box width={sidebarWidth} height={bodyHeight}>
					<Sidebar
						rows={sidebarRows}
						active={filter}
						focusedKey={focus === "sidebar" ? sidebarFocusedKey : null}
						focused={focus === "sidebar"}
						width={sidebarWidth}
						height={bodyHeight}
					/>
				</Box>

				<Box flexDirection="column" width={boardAreaWidth} height={bodyHeight}>
					<Subbar
						filter={filter}
						visible={visibleCount}
						total={totalCount}
						searchQuery={searchQuery}
					/>

					{overlay ? (
						<Box
							height={boardHeight}
							width={boardAreaWidth}
							paddingX={1}
							paddingY={1}
						>
							{overlay}
						</Box>
					) : mode.kind === "edit" ? (
						<Box
							height={boardHeight}
							width={boardAreaWidth}
							alignItems="center"
							justifyContent="center"
						>
							<TaskEditor
								task={mode.task}
								ctx={ctx}
								onClose={() => {
									if (mode.kind !== "edit") return;
									if (mode.returnTo === "detail") {
										setMode({ kind: "detail", task: mode.task });
									} else {
										setMode({ kind: "browse" });
									}
								}}
								onSaved={(updated) => {
									flashToast(`Saved ${updated.id}`);
									void reload();
									if (mode.kind !== "edit") return;
									if (mode.returnTo === "detail") {
										setMode({ kind: "detail", task: updated });
									} else {
										setMode({ kind: "browse" });
									}
								}}
								width={popupWidth}
								height={popupHeight}
							/>
						</Box>
					) : showDetail && mode.kind === "detail" ? (
						<Box
							height={boardHeight}
							width={boardAreaWidth}
							alignItems="center"
							justifyContent="center"
						>
							<TaskDetail
								task={mode.task}
								onClose={() => setMode({ kind: "browse" })}
								onEdit={() => {
									if (mode.kind !== "detail") return;
									setMode({ kind: "edit", task: mode.task, returnTo: "detail" });
								}}
								onEditExternal={() => {
									if (mode.kind !== "detail") return;
									const target = mode.task;
									setMode({ kind: "browse" });
									launchEditor(target);
								}}
								width={popupWidth}
								height={popupHeight}
							/>
						</Box>
					) : !loaded ? (
						<Box height={boardHeight} paddingX={1}>
							<Text color={theme.textMuted}>Loading…</Text>
						</Box>
					) : showingBoardColumns || filter.kind === "archived" ? (
						renderBoard()
					) : (
						renderBoard()
					)}
				</Box>
			</Box>

			<Box paddingX={1} width={termCols}>
				<Text wrap="truncate-end">
					{footerPrefix ? (
						<Text color={theme.textMuted}>{footerPrefix}</Text>
					) : null}
					{footerHints.map((hint, idx) => (
						<Text key={`${hint.keys}-${hint.label}`}>
							{idx > 0 ? (
								<Text color={theme.textFaint}>{"  ·  "}</Text>
							) : null}
							<Text color={theme.textDim} bold>
								{hint.keys}
							</Text>
							<Text color={theme.textMuted}>{` ${hint.label}`}</Text>
						</Text>
					))}
				</Text>
			</Box>
		</Box>
	);
}

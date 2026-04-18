import { spawn } from "node:child_process";
import {
	createContext as createStoreContext,
	createTask,
	listTasks,
	moveTask,
	updateTask,
	watchTasks,
	type StoreContext,
	type Task,
} from "@ordna/core";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Column } from "./Column.js";
import { useTerminalSize } from "./hooks.js";
import { SelectPrompt } from "./SelectPrompt.js";
import { TaskDetail } from "./TaskDetail.js";
import { TextPrompt } from "./TextPrompt.js";
import { theme } from "./theme.js";

type Mode =
	| { kind: "browse" }
	| { kind: "detail"; task: Task }
	| { kind: "create" }
	| { kind: "assign"; task: Task }
	| { kind: "move"; task: Task }
	| { kind: "search" };

function groupByStatus(tasks: Task[], statuses: string[]): Map<string, Task[]> {
	const groups = new Map<string, Task[]>();
	for (const status of statuses) groups.set(status, []);
	for (const task of tasks) {
		const bucket = groups.get(task.status);
		if (bucket) bucket.push(task);
	}
	return groups;
}

export function App(): React.JSX.Element {
	const { exit } = useApp();
	const { setRawMode } = useStdin();
	const { rows, columns } = useTerminalSize();
	const [ctx] = useState<StoreContext>(() => createStoreContext());
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [columnIndex, setColumnIndex] = useState(0);
	const [rowIndex, setRowIndex] = useState(0);
	const [mode, setMode] = useState<Mode>({ kind: "browse" });
	const [searchQuery, setSearchQuery] = useState("");
	const [toast, setToast] = useState<string | null>(null);
	const [grabbedId, setGrabbedId] = useState<string | null>(null);

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

	const filteredTasks = useMemo<Task[]>(() => {
		if (!searchQuery) return tasks;
		const q = searchQuery.toLowerCase();
		return tasks.filter(
			(t) =>
				t.title.toLowerCase().includes(q) ||
				t.id.toLowerCase().includes(q) ||
				t.tags.some((tag) => tag.toLowerCase().includes(q)),
		);
	}, [tasks, searchQuery]);

	const groups = useMemo(() => groupByStatus(filteredTasks, statuses), [filteredTasks, statuses]);

	const activeStatus = statuses[columnIndex] ?? statuses[0] ?? "";
	const activeColumn = groups.get(activeStatus) ?? [];
	const selectedTask: Task | undefined = activeColumn[rowIndex];

	useEffect(() => {
		if (rowIndex >= activeColumn.length) {
			setRowIndex(Math.max(0, activeColumn.length - 1));
		}
	}, [activeColumn.length, rowIndex]);

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

	const moveGrabbedTo = async (targetIndex: number): Promise<void> => {
		if (grabbedId === null) return;
		const targetStatus = statuses[targetIndex];
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
			setRowIndex(Math.max(0, nextIdx));
		} catch (error) {
			flashToast((error as Error).message);
		}
	};

	useInput(
		async (input, key) => {
			if (mode.kind !== "browse") return;

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
					await moveGrabbedTo(Math.min(statuses.length - 1, columnIndex + 1));
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
				setColumnIndex((i) => Math.min(statuses.length - 1, i + 1));
				setRowIndex(0);
			} else if (key.upArrow || input === "k") {
				setRowIndex((i) => Math.max(0, i - 1));
			} else if (key.downArrow || input === "j") {
				setRowIndex((i) => Math.min(Math.max(0, activeColumn.length - 1), i + 1));
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
				launchEditor(selectedTask);
			} else if (input === "/") {
				setMode({ kind: "search" });
			} else if (key.escape && searchQuery) {
				setSearchQuery("");
			}
		},
		{ isActive: mode.kind === "browse" },
	);

	const flashToast = (message: string): void => {
		setToast(message);
		setTimeout(() => setToast((t) => (t === message ? null : t)), 2500);
	};

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

	const colCount = Math.max(1, statuses.length);
	const colWidth = Math.max(20, Math.floor(columns / colCount));
	const bodyHeight = Math.max(5, rows - 4);

	const renderBoard = (): React.JSX.Element => (
		<Box flexDirection="row" height={bodyHeight} width={columns}>
			{statuses.map((s, idx) => (
				<Column
					key={s}
					status={s}
					tasks={groups.get(s) ?? []}
					focused={idx === columnIndex && mode.kind === "browse"}
					selectedIndex={idx === columnIndex ? rowIndex : -1}
					grabbedId={grabbedId}
					width={idx === statuses.length - 1 ? columns - colWidth * (statuses.length - 1) : colWidth}
					height={bodyHeight}
				/>
			))}
		</Box>
	);

	const popupWidth = Math.min(columns - 4, Math.max(40, Math.floor(columns * 0.7)));
	const popupHeight = Math.min(bodyHeight - 2, Math.max(10, Math.floor(bodyHeight * 0.8)));

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
					options={statuses}
					initialIndex={Math.max(0, statuses.indexOf(mode.task.status))}
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

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			<Box paddingX={1} width={columns}>
				<Text bold color="cyan">
					ordna
				</Text>
				<Text color={theme.textDim}>{`  ${ctx.tasksDir}`}</Text>
				{searchQuery ? (
					<Text color="yellow">{`   /${searchQuery}`}</Text>
				) : null}
				<Box flexGrow={1} />
				{toast ? <Text color="green">{toast}</Text> : null}
			</Box>

			{overlay ? (
				<Box height={bodyHeight} width={columns} paddingX={1} paddingY={1}>
					{overlay}
				</Box>
			) : showDetail && mode.kind === "detail" ? (
				<Box
					height={bodyHeight}
					width={columns}
					alignItems="center"
					justifyContent="center"
				>
					<TaskDetail
						task={mode.task}
						onClose={() => setMode({ kind: "browse" })}
						onEdit={() => {
							const target = mode.task;
							setMode({ kind: "browse" });
							launchEditor(target);
						}}
						width={popupWidth}
						height={popupHeight}
					/>
				</Box>
			) : !loaded ? (
				<Box height={bodyHeight} paddingX={1}>
					<Text color={theme.textDim}>Loading…</Text>
				</Box>
			) : (
				renderBoard()
			)}

			<Box paddingX={1} width={columns}>
				<Text color={theme.textDim} wrap="truncate-end">
					{grabbedId
						? `moving ${grabbedId} · ← → to move · space / enter to drop · esc to cancel`
						: "←/→ cols · ↑/↓ tasks · Space grab · Enter open · c new · m move · a assign · e edit · / find · q quit"}
				</Text>
			</Box>
		</Box>
	);
}

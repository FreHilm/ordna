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
	const [ctx] = useState<StoreContext>(() => createStoreContext());
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [columnIndex, setColumnIndex] = useState(0);
	const [rowIndex, setRowIndex] = useState(0);
	const [mode, setMode] = useState<Mode>({ kind: "browse" });
	const [searchQuery, setSearchQuery] = useState("");
	const [status, setStatus] = useState<string | null>(null);

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

	useInput(
		async (input, key) => {
			if (mode.kind !== "browse") return;
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

	const onCreate = async (title: string): Promise<void> => {
		try {
			await createTask({ title }, ctx);
			setStatus(`Created "${title}"`);
			await reload();
		} catch (error) {
			setStatus((error as Error).message);
		}
		setMode({ kind: "browse" });
	};

	const onMove = async (targetStatus: string): Promise<void> => {
		if (mode.kind !== "move") return;
		try {
			await moveTask(mode.task.id, targetStatus, ctx);
			setStatus(`${mode.task.id} → ${targetStatus}`);
			await reload();
		} catch (error) {
			setStatus((error as Error).message);
		}
		setMode({ kind: "browse" });
	};

	const onAssign = async (name: string): Promise<void> => {
		if (mode.kind !== "assign") return;
		try {
			const value = name.trim().length === 0 ? null : name.trim();
			await updateTask(mode.task.id, { assignee: value }, ctx);
			setStatus(`${mode.task.id} ${value ? `→ @${value}` : "unassigned"}`);
			await reload();
		} catch (error) {
			setStatus((error as Error).message);
		}
		setMode({ kind: "browse" });
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					ordna
				</Text>
				<Text color={theme.textDim}>{`  ${ctx.tasksDir}`}</Text>
				{searchQuery ? (
					<Text color="yellow">{`   search: "${searchQuery}"`}</Text>
				) : null}
			</Box>

			{!loaded ? (
				<Text color={theme.textDim}>Loading…</Text>
			) : (
				<Box flexDirection="row">
					{statuses.map((s, idx) => (
						<Column
							key={s}
							status={s}
							tasks={groups.get(s) ?? []}
							focused={idx === columnIndex && mode.kind === "browse"}
							selectedIndex={idx === columnIndex ? rowIndex : -1}
						/>
					))}
				</Box>
			)}

			{mode.kind === "detail" ? (
				<TaskDetail task={mode.task} onClose={() => setMode({ kind: "browse" })} />
			) : null}

			{mode.kind === "create" ? (
				<TextPrompt
					label="New task title"
					onSubmit={onCreate}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			) : null}

			{mode.kind === "move" ? (
				<SelectPrompt
					label={`Move ${mode.task.id} to…`}
					options={statuses}
					initialIndex={Math.max(0, statuses.indexOf(mode.task.status))}
					onSubmit={onMove}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			) : null}

			{mode.kind === "assign" ? (
				<TextPrompt
					label={`Assign ${mode.task.id} (blank to unassign)`}
					initialValue={mode.task.assignee ?? ""}
					onSubmit={onAssign}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			) : null}

			{mode.kind === "search" ? (
				<TextPrompt
					label="Search"
					initialValue={searchQuery}
					onSubmit={(v) => {
						setSearchQuery(v);
						setMode({ kind: "browse" });
					}}
					onCancel={() => setMode({ kind: "browse" })}
				/>
			) : null}

			<Box marginTop={1}>
				<Text color={theme.textDim}>
					←/→ columns · ↑/↓ tasks · Enter open · c create · m move · a assign · e edit · / search ·
					q quit
				</Text>
			</Box>

			{status ? (
				<Box marginTop={1}>
					<Text color="green">{status}</Text>
				</Box>
			) : null}
		</Box>
	);
}

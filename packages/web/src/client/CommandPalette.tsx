import { useEffect, useMemo, useRef, useState } from "react";
import type { WireTask } from "../shared/types.js";
import { Icon } from "./icons.js";

export interface PaletteAction {
	id: string;
	label: string;
	hint?: string;
	icon?: keyof typeof Icon;
	run: () => void;
}

interface Props {
	tasks: WireTask[];
	actions: PaletteAction[];
	onOpenTask: (id: string) => void;
	onClose: () => void;
}

interface Entry {
	kind: "action" | "task";
	id: string;
	label: string;
	hint?: string;
	icon?: keyof typeof Icon;
	run: () => void;
}

export function CommandPalette({ tasks, actions, onOpenTask, onClose }: Props): JSX.Element {
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const entries = useMemo<Entry[]>(() => {
		const q = query.trim().toLowerCase();
		const actionEntries: Entry[] = actions.map((a) => ({
			kind: "action",
			id: a.id,
			label: a.label,
			hint: a.hint,
			icon: a.icon,
			run: a.run,
		}));
		const taskEntries: Entry[] = tasks.map((t) => ({
			kind: "task",
			id: t.id,
			label: t.title,
			hint: t.id,
			run: () => onOpenTask(t.id),
		}));
		const all = [...actionEntries, ...taskEntries];
		if (!q) return all.slice(0, 40);
		return all
			.filter(
				(e) =>
					e.label.toLowerCase().includes(q) ||
					(e.hint ?? "").toLowerCase().includes(q),
			)
			.slice(0, 40);
	}, [actions, tasks, query, onOpenTask]);

	useEffect(() => {
		setIndex(0);
	}, []);

	useEffect(() => {
		if (index >= entries.length) setIndex(Math.max(0, entries.length - 1));
	}, [entries.length, index]);

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setIndex((i) => Math.min(entries.length - 1, i + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setIndex((i) => Math.max(0, i - 1));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const entry = entries[index];
			if (entry) {
				entry.run();
				onClose();
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		}
	};

	const actionsList = entries.filter((e) => e.kind === "action");
	const tasksList = entries.filter((e) => e.kind === "task");

	return (
		<div className="palette-scrim" onClick={onClose}>
			<div className="palette" onClick={(e) => e.stopPropagation()}>
				<div className="palette-input-row">
					<Icon.Search />
					<input
						ref={inputRef}
						className="palette-input"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Type a command or search tasks…"
					/>
					<span className="kbd">esc</span>
				</div>
				<div className="palette-list">
					{actionsList.length > 0 ? <div className="palette-group">Actions</div> : null}
					{actionsList.map((e, i) => (
						<PaletteRow
							key={e.id}
							entry={e}
							active={entries.indexOf(e) === index}
							onHover={() => setIndex(entries.indexOf(e))}
							onPick={() => {
								e.run();
								onClose();
							}}
						/>
					))}
					{tasksList.length > 0 ? <div className="palette-group">Tasks</div> : null}
					{tasksList.map((e) => (
						<PaletteRow
							key={e.id}
							entry={e}
							active={entries.indexOf(e) === index}
							onHover={() => setIndex(entries.indexOf(e))}
							onPick={() => {
								e.run();
								onClose();
							}}
						/>
					))}
					{entries.length === 0 ? (
						<div
							className="palette-group"
							style={{ padding: "18px 12px", textTransform: "none" }}
						>
							No results
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

function PaletteRow({
	entry,
	active,
	onHover,
	onPick,
}: {
	entry: Entry;
	active: boolean;
	onHover: () => void;
	onPick: () => void;
}): JSX.Element {
	const IconCmp = entry.icon ? Icon[entry.icon] : Icon.Hash;
	return (
		<button
			type="button"
			className={`palette-item ${active ? "active" : ""}`}
			onMouseEnter={onHover}
			onClick={onPick}
		>
			<span className="palette-item-icon">
				<IconCmp />
			</span>
			<span>{entry.label}</span>
			{entry.hint ? <span className="palette-item-sub">{entry.hint}</span> : null}
		</button>
	);
}

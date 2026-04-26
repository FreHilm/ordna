import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentHookInfo, OrdnaConfig, WireTask } from "../shared/types.js";
import {
	ACCEPTANCE_HEADING_RE,
	type AcceptanceItem,
	parseAcceptance,
	serializeAcceptance,
} from "./acceptance.js";
import { AcceptanceList } from "./AcceptanceList.js";
import { AcceptanceView } from "./AcceptanceView.js";
import { api } from "./api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Avatar, Icon, tagColor } from "./icons.js";
import { TagInput } from "./TagInput.js";

interface Props {
	task: WireTask;
	config: OrdnaConfig;
	startInEdit?: boolean;
	onClose: () => void;
	onSaved: (task: WireTask) => void;
	onDelete: (id: string) => void;
	agentHook?: AgentHookInfo | null;
	onAgent?: (id: string) => void;
}

type Priority = "high" | "medium" | "low";

interface EditableSection {
	heading: string;
	level: number;
	content: string;
}

type Draft = {
	title: string;
	status: string;
	assignee: string;
	priority: Priority | "";
	tags: string[];
	depends_on: string[];
	sections: EditableSection[];
	acceptance: AcceptanceItem[];
	acceptanceSectionIdx: number | null;
};

function isAcceptance(heading: string): boolean {
	return ACCEPTANCE_HEADING_RE.test(heading.trim());
}

function toDraft(task: WireTask): Draft {
	const sections = task.sections.map((s) => ({ ...s }));
	const acceptanceSectionIdx = sections.findIndex((s) => isAcceptance(s.heading));
	const acceptance =
		acceptanceSectionIdx >= 0 ? parseAcceptance(sections[acceptanceSectionIdx]?.content ?? "") : [];

	return {
		title: task.title,
		status: task.status,
		assignee: task.assignee ?? "",
		priority: (task.priority as Priority | null) ?? "",
		tags: [...task.tags],
		depends_on: [...task.depends_on],
		sections,
		acceptance,
		acceptanceSectionIdx: acceptanceSectionIdx >= 0 ? acceptanceSectionIdx : null,
	};
}

function sectionsForSave(draft: Draft): EditableSection[] {
	if (draft.acceptanceSectionIdx === null) return draft.sections;
	return draft.sections.map((s, idx) =>
		idx === draft.acceptanceSectionIdx
			? { ...s, content: serializeAcceptance(draft.acceptance) }
			: s,
	);
}

function arrayEq(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
	return true;
}

function isDirty(task: WireTask, draft: Draft): boolean {
	if (draft.title.trim() !== task.title) return true;
	if (draft.status !== task.status) return true;
	const assignee = draft.assignee.trim() === "" ? null : draft.assignee.trim();
	if (assignee !== (task.assignee ?? null)) return true;
	const priority = draft.priority === "" ? null : draft.priority;
	if (priority !== (task.priority ?? null)) return true;
	if (!arrayEq(draft.tags, task.tags)) return true;
	if (!arrayEq(draft.depends_on, task.depends_on)) return true;
	const next = sectionsForSave(draft);
	if (next.length !== task.sections.length) return true;
	for (let i = 0; i < next.length; i += 1) {
		const a = next[i];
		const b = task.sections[i];
		if (!a || !b) return true;
		if (a.heading !== b.heading || a.level !== b.level || a.content !== b.content) {
			return true;
		}
	}
	return false;
}

export function TaskModal({
	task,
	config,
	startInEdit,
	onClose,
	onSaved,
	onDelete,
	agentHook,
	onAgent,
}: Props): JSX.Element {
	const [editing, setEditing] = useState<boolean>(Boolean(startInEdit));
	const [draft, setDraft] = useState<Draft>(() => toDraft(task));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pendingExit, setPendingExit] = useState<null | "close" | "exit-edit">(null);
	// Tracks whether this modal session was opened directly into edit mode
	// (e.g. via the card's Edit button). Save / Cancel close the modal in that
	// case; otherwise they fall back to view mode.
	const closeAfterEdit = useRef<boolean>(Boolean(startInEdit));

	const dirty = editing && isDirty(task, draft);

	const requestClose = (): void => {
		if (editing && dirty) setPendingExit("close");
		else onClose();
	};

	const requestExitEdit = (): void => {
		if (!editing) return;
		if (dirty) {
			setPendingExit("exit-edit");
		} else if (closeAfterEdit.current) {
			onClose();
		} else {
			setEditing(false);
		}
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key !== "Escape") return;
			if (pendingExit !== null) return;
			if (editing && dirty) setPendingExit("close");
			else onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [editing, dirty, pendingExit, onClose]);

	useEffect(() => {
		setDraft(toDraft(task));
	}, [task]);

	useEffect(() => {
		if (startInEdit) {
			setEditing(true);
			closeAfterEdit.current = true;
		}
	}, [startInEdit, task.id]);

	const viewAcceptance = useMemo<AcceptanceItem[]>(() => {
		const section = task.sections.find((s) => isAcceptance(s.heading));
		return section ? parseAcceptance(section.content) : [];
	}, [task]);

	const onSave = async (): Promise<void> => {
		setSaving(true);
		setError(null);
		try {
			const updated = await api.update(task.id, {
				title: draft.title.trim(),
				status: draft.status,
				assignee: draft.assignee.trim() === "" ? null : draft.assignee.trim(),
				priority: draft.priority === "" ? null : draft.priority,
				tags: draft.tags,
				depends_on: draft.depends_on,
				sections: sectionsForSave(draft),
			});
			onSaved(updated);
			if (closeAfterEdit.current) {
				onClose();
			} else {
				setEditing(false);
			}
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setSaving(false);
		}
	};

	const quickToggleAc = async (id: string, checked: boolean): Promise<void> => {
		const section = task.sections.find((s) => isAcceptance(s.heading));
		if (!section) return;
		const items = parseAcceptance(section.content).map((i) =>
			i.id === id ? { ...i, checked } : i,
		);
		const nextSections = task.sections.map((s) =>
			isAcceptance(s.heading) ? { ...s, content: serializeAcceptance(items) } : s,
		);
		try {
			const updated = await api.update(task.id, { sections: nextSections });
			onSaved(updated);
		} catch (e) {
			setError((e as Error).message);
		}
	};

	const sectionsForDisplay = task.sections.filter(
		(s) => !isAcceptance(s.heading) && s.heading !== "",
	);
	const editableNonAcSections = draft.sections.filter(
		(s, idx) => idx !== draft.acceptanceSectionIdx && s.heading !== "",
	);

	return (
		<div className="scrim" onClick={requestClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<div className="modal-head">
					<span className="modal-id">{task.id}</span>
					<span className="modal-sublabel">
						in <strong>{task.status}</strong>
					</span>
					<div className="modal-actions">
						{agentHook?.enabled ? (
							<button
								type="button"
								className="btn btn-agent"
								title={`Send task to ${agentHook.label}`}
								onClick={() => onAgent?.(task.id)}
							>
								{agentHook.label}
							</button>
						) : null}
						<button
							type="button"
							className="btn-icon"
							title={editing ? "Exit edit" : "Edit"}
							onClick={() => {
								if (editing) requestExitEdit();
								else setEditing(true);
							}}
						>
							<Icon.Edit />
						</button>
						<button
							type="button"
							className="btn-icon btn-danger"
							title="Delete"
							onClick={() => onDelete(task.id)}
						>
							<Icon.Trash />
						</button>
						<button type="button" className="btn-icon" title="Close" onClick={requestClose}>
							<Icon.X />
						</button>
					</div>
				</div>

				{editing ? (
					<input
						className="modal-title"
						value={draft.title}
						onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
						autoFocus
					/>
				) : (
					<h1 className="modal-title">{task.title}</h1>
				)}
				<div className="modal-sub">
					Created {task.created_at} · updated {task.updated_at}
				</div>

				{error ? (
					<div style={{ padding: "0 24px 12px" }}>
						<div className="form-error">{error}</div>
					</div>
				) : null}

				<div className="modal-grid">
					<div>
						<div className="section">
							<span className="section-label">Tags</span>
							{editing ? (
								<TagInput
									id="tf-tags"
									values={draft.tags}
									onChange={(next) => setDraft((d) => ({ ...d, tags: next }))}
									placeholder="Type and press space, comma, or enter"
								/>
							) : task.tags.length > 0 ? (
								<div className="tags-view">
									{task.tags.map((t) => (
										<span key={t} className={`chip ${tagColor(t)}`}>
											#{t}
										</span>
									))}
								</div>
							) : (
								<div className="section-empty">No tags</div>
							)}
						</div>

						<div className="section">
							{editing ? (
								draft.acceptanceSectionIdx !== null ? (
									<AcceptanceList
										items={draft.acceptance}
										onChange={(next) =>
											setDraft((d) => ({ ...d, acceptance: next }))
										}
									/>
								) : (
									<div className="section-empty">
										No Acceptance Criteria section in this task.
									</div>
								)
							) : (
								<AcceptanceView items={viewAcceptance} onToggle={quickToggleAc} />
							)}
						</div>

						{editing
							? editableNonAcSections.map((section) => {
									const idx = draft.sections.findIndex(
										(s) => s.heading === section.heading && s.level === section.level,
									);
									return (
										<div key={`${section.heading}-${idx}`} className="section">
											<span className="section-label">{section.heading}</span>
											<textarea
												className="textarea"
												value={section.content}
												onChange={(e) => {
													const next = e.target.value;
													setDraft((d) => ({
														...d,
														sections: d.sections.map((s, i) =>
															i === idx ? { ...s, content: next } : s,
														),
													}));
												}}
											/>
										</div>
									);
								})
							: sectionsForDisplay.map((section, idx) => (
									<div key={`${section.heading}-${idx}`} className="section">
										<span className="section-label">{section.heading}</span>
										{section.content ? (
											<p className="section-body">{section.content}</p>
										) : (
											<div className="section-empty">—</div>
										)}
									</div>
								))}
					</div>

					<div className="side-panel">
						<div>
							<span className="side-field-label">Status</span>
							{editing ? (
								<div className="select-wrap">
									<select
										className="select"
										value={draft.status}
										onChange={(e) =>
											setDraft((d) => ({ ...d, status: e.target.value }))
										}
									>
										{config.statuses.map((s) => (
											<option key={s} value={s}>
												{s}
											</option>
										))}
										<option value="archived">archived</option>
									</select>
								</div>
							) : (
								<div className="pill-value">{task.status}</div>
							)}
						</div>
						<div>
							<span className="side-field-label">Priority</span>
							{editing ? (
								<div className="select-wrap">
									<select
										className="select"
										value={draft.priority}
										onChange={(e) =>
											setDraft((d) => ({
												...d,
												priority: e.target.value as Priority | "",
											}))
										}
									>
										<option value="">—</option>
										<option value="high">High</option>
										<option value="medium">Medium</option>
										<option value="low">Low</option>
									</select>
								</div>
							) : task.priority ? (
								<div className="pill-value">
									<span
										className="prio-dot"
										style={{
											width: 8,
											height: 8,
											borderRadius: "50%",
											background:
												task.priority === "high"
													? "var(--prio-high)"
													: task.priority === "medium"
														? "var(--prio-med)"
														: "var(--prio-low)",
										}}
									/>
									{task.priority}
								</div>
							) : (
								<div className="pill-value" style={{ color: "var(--text-4)" }}>
									—
								</div>
							)}
						</div>
						<div>
							<span className="side-field-label">Assignee</span>
							{editing ? (
								<input
									className="input"
									value={draft.assignee}
									onChange={(e) =>
										setDraft((d) => ({ ...d, assignee: e.target.value }))
									}
									placeholder="unassigned"
								/>
							) : (
								<div className="pill-value">
									<Avatar name={task.assignee} size={18} />
									<span>
										{task.assignee ? (
											`@${task.assignee}`
										) : (
											<span style={{ color: "var(--text-4)" }}>unassigned</span>
										)}
									</span>
								</div>
							)}
						</div>
						<div>
							<span className="side-field-label">Depends on</span>
							{editing ? (
								<TagInput
									id="tf-depends-on"
									values={draft.depends_on}
									onChange={(next) =>
										setDraft((d) => ({ ...d, depends_on: next }))
									}
									placeholder="e.g. T-001"
									chipClassName="chip dep"
								/>
							) : task.depends_on.length === 0 ? (
								<div style={{ color: "var(--text-4)", fontSize: 12 }}>—</div>
							) : (
								task.depends_on.map((d) => (
									<div key={d} className="dep-pill" title={d}>
										<span className="dot" style={{ background: "var(--accent)" }} />
										<span className="dep-id">{d}</span>
									</div>
								))
							)}
						</div>
					</div>
				</div>

				{editing ? (
					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							gap: 8,
							padding: "0 24px 20px",
						}}
					>
						<button
							type="button"
							className="btn"
							onClick={() => {
								setDraft(toDraft(task));
								setError(null);
								if (closeAfterEdit.current) {
									onClose();
								} else {
									setEditing(false);
								}
							}}
						>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn-primary"
							onClick={() => void onSave()}
							disabled={saving}
						>
							{saving ? "Saving…" : "Save"}
						</button>
					</div>
				) : null}
			</div>
			{pendingExit !== null ? (
				<ConfirmDialog
					title="Unsaved changes"
					message="You have unsaved changes to this task. Save them, discard them, or keep editing?"
					confirmLabel="Save"
					secondaryLabel="Don't save"
					cancelLabel="Cancel"
					onCancel={() => setPendingExit(null)}
					onSecondary={() => {
						const intent = pendingExit;
						setPendingExit(null);
						setDraft(toDraft(task));
						setError(null);
						if (intent === "close") {
							onClose();
						} else if (closeAfterEdit.current) {
							onClose();
						} else {
							setEditing(false);
						}
					}}
					onConfirm={() => {
						const intent = pendingExit;
						setPendingExit(null);
						if (intent === "close") closeAfterEdit.current = true;
						void onSave();
					}}
				/>
			) : null}
		</div>
	);
}

import { useEffect, useMemo, useState } from "react";
import type { OrdnaConfig, WireTask } from "../shared/types.js";
import {
	ACCEPTANCE_HEADING_RE,
	type AcceptanceItem,
	parseAcceptance,
	serializeAcceptance,
} from "./acceptance.js";
import { AcceptanceList } from "./AcceptanceList.js";
import { AcceptanceView } from "./AcceptanceView.js";
import { api } from "./api.js";
import { TagInput } from "./TagInput.js";

interface Props {
	task: WireTask;
	config: OrdnaConfig;
	startInEdit?: boolean;
	onClose: () => void;
	onSaved: (task: WireTask) => void;
}

type Priority = "high" | "medium" | "low";
const PRIORITIES: Array<Priority | ""> = ["", "low", "medium", "high"];

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

export function TaskModal({
	task,
	config,
	startInEdit,
	onClose,
	onSaved,
}: Props): JSX.Element {
	const [editing, setEditing] = useState<boolean>(Boolean(startInEdit));
	const [draft, setDraft] = useState<Draft>(() => toDraft(task));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	useEffect(() => {
		setDraft(toDraft(task));
	}, [task]);

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
			setEditing(false);
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setSaving(false);
		}
	};

	const cancelEdit = (): void => {
		setDraft(toDraft(task));
		setEditing(false);
		setError(null);
	};

	const quickToggleAc = async (id: string, checked: boolean): Promise<void> => {
		const section = task.sections.find((s) => isAcceptance(s.heading));
		if (!section) return;
		const items = parseAcceptance(section.content).map((i) =>
			i.id === id ? { ...i, checked } : i,
		);
		// Rebuild sections with updated AC content
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

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal task-modal" onClick={(e) => e.stopPropagation()}>
				<div className="task-modal-head">
					<span className="task-modal-id">{task.id}</span>
					<div className="spacer" />
					{!editing ? (
						<button type="button" onClick={() => setEditing(true)}>
							Edit
						</button>
					) : null}
					<button type="button" onClick={onClose}>
						Close
					</button>
				</div>

				{editing ? (
					<EditForm
						draft={draft}
						setDraft={setDraft}
						config={config}
						onSave={onSave}
						onCancel={cancelEdit}
						saving={saving}
						error={error}
					/>
				) : (
					<ViewBody
						task={task}
						acceptance={viewAcceptance}
						onToggleAc={quickToggleAc}
						error={error}
					/>
				)}
			</div>
		</div>
	);
}

function ViewBody({
	task,
	acceptance,
	onToggleAc,
	error,
}: {
	task: WireTask;
	acceptance: AcceptanceItem[];
	onToggleAc: (id: string, checked: boolean) => void;
	error: string | null;
}): JSX.Element {
	const nonAcceptanceSections = task.sections.filter((s) => !isAcceptance(s.heading));
	return (
		<>
			<h2 className="task-modal-title">{task.title}</h2>
			<div className="task-modal-meta">
				<span className={`chip status-${task.status}`}>{task.status}</span>
				{task.priority ? (
					<span className={`chip priority ${task.priority}`}>{task.priority}</span>
				) : null}
				<span className="chip subtle">
					{task.assignee ? `@${task.assignee}` : "unassigned"}
				</span>
				{task.tags.map((t) => (
					<span key={t} className="chip tag">
						#{t}
					</span>
				))}
			</div>
			{task.depends_on.length > 0 ? (
				<div className="task-modal-deps">depends on: {task.depends_on.join(", ")}</div>
			) : null}
			{error ? <div className="form-error inline">{error}</div> : null}
			<div className="task-modal-body">
				<section>
					<AcceptanceView items={acceptance} onToggle={onToggleAc} />
				</section>
				{nonAcceptanceSections.map((section, idx) => (
					<section key={`${section.heading}-${idx}`}>
						{section.heading !== "" ? <h3>{section.heading}</h3> : null}
						{section.content ? (
							<pre>{section.content}</pre>
						) : (
							<div className="empty-inline">—</div>
						)}
					</section>
				))}
			</div>
		</>
	);
}

interface EditFormProps {
	draft: Draft;
	setDraft: (updater: (prev: Draft) => Draft) => void;
	config: OrdnaConfig;
	onSave: () => void;
	onCancel: () => void;
	saving: boolean;
	error: string | null;
}

function EditForm({
	draft,
	setDraft,
	config,
	onSave,
	onCancel,
	saving,
	error,
}: EditFormProps): JSX.Element {
	return (
		<form
			className="task-modal-form"
			onSubmit={(e) => {
				e.preventDefault();
				if (!saving) onSave();
			}}
		>
			<label>
				<span>Title</span>
				<input
					value={draft.title}
					onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
					autoFocus
				/>
			</label>

			<div className="row-3">
				<label>
					<span>Status</span>
					<select
						value={draft.status}
						onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
					>
						{config.statuses.map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>Priority</span>
					<select
						value={draft.priority}
						onChange={(e) =>
							setDraft((d) => ({
								...d,
								priority: e.target.value as Priority | "",
							}))
						}
					>
						{PRIORITIES.map((p) => (
							<option key={p || "none"} value={p}>
								{p || "—"}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>Assignee</span>
					<input
						value={draft.assignee}
						onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))}
						placeholder="—"
					/>
				</label>
			</div>

			<div className="row-2">
				<label htmlFor="tf-tags">
					<span>Tags</span>
					<TagInput
						id="tf-tags"
						values={draft.tags}
						onChange={(next) => setDraft((d) => ({ ...d, tags: next }))}
						placeholder="Type and press space, comma, or enter"
					/>
				</label>
				<label htmlFor="tf-depends-on">
					<span>Depends on</span>
					<TagInput
						id="tf-depends-on"
						values={draft.depends_on}
						onChange={(next) => setDraft((d) => ({ ...d, depends_on: next }))}
						placeholder="e.g. T-001"
						chipClassName="chip dep"
					/>
				</label>
			</div>

			{draft.acceptanceSectionIdx !== null ? (
				<AcceptanceList
					items={draft.acceptance}
					onChange={(next) => setDraft((d) => ({ ...d, acceptance: next }))}
				/>
			) : null}

			{draft.sections.map((section, idx) => {
				if (idx === draft.acceptanceSectionIdx) return null;
				const heading = section.heading === "" ? "Intro" : section.heading;
				return (
					<label key={`${section.heading}-${idx}`} className="section-field">
						<span>{heading}</span>
						<textarea
							rows={heading.toLowerCase().includes("note") ? 3 : 5}
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
					</label>
				);
			})}

			{error ? <div className="form-error">{error}</div> : null}

			<div className="row">
				<button type="button" onClick={onCancel} disabled={saving}>
					Cancel
				</button>
				<button type="submit" className="primary" disabled={saving}>
					{saving ? "Saving…" : "Save"}
				</button>
			</div>
		</form>
	);
}

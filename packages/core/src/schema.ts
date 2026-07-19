import { z } from "zod";

export type Priority = "high" | "medium" | "low";

export type SchemaMode = "ordna" | "backlog";

export interface AcceptanceItem {
	text: string;
	checked: boolean;
}

export interface Section {
	heading: string;
	level: number;
	content: string;
}

/**
 * A file attached to a task.
 *
 * The record is backend-agnostic: it's the canonical registry entry
 * that round-trips through the task's frontmatter. The bytes live
 * wherever the active storage backend puts them — `src` is the
 * backend's **opaque** locator and must never be interpreted by UI
 * code. To get bytes, go through `Backend.attachments?.read()`.
 *
 *  - file / hybrid backends: `src` is a path relative to `tasksDir`
 *    (e.g. `attachments/T-001/a1-chart.png`), committed to git
 *  - namespace backend: `src` is `git:<blob-oid>`, anchored by a
 *    `refs/ordna/attachments/<taskId>/<attId>` ref
 *  - remote backends (future): `src` is the provider URL
 */
export interface Attachment {
	/** Stable id, unique within the task (e.g. `a1`). Never derived from the filename. */
	id: string;
	/** Original filename — used as the display label and download name. */
	name: string;
	/** Best-effort media type (MIME), or null when it can't be inferred. */
	type: string | null;
	/** Size in bytes. */
	size: number;
	/** Date added, `YYYY-MM-DD`. */
	added: string;
	/** Opaque backend locator. Only the backend that wrote it may interpret it. */
	src: string;
}

export interface Task {
	id: string;
	title: string;
	status: string;
	assignee: string | null;
	priority: Priority | null;
	tags: string[];
	depends_on: string[];
	created_at: string;
	updated_at: string;
	/**
	 * Files attached to the task. The canonical registry — round-trips
	 * through frontmatter. Empty array when the task has no attachments
	 * (the `attachments:` key is omitted from the file entirely). Mutated
	 * only through `Backend.attachments?`, never via `update()`.
	 */
	attachments: Attachment[];
	sections: Section[];
	extra_frontmatter: Record<string, unknown>;
	/**
	 * On-disk location of the task file.
	 *
	 * Set by the file and hybrid backends (tasks live as `.md` files).
	 * **Unset** by the namespace backend — tasks there live as git
	 * blobs at `refs/ordna/tasks/<id>` with no working-tree presence.
	 * Consumers must guard against `undefined` (the CLI editor launcher
	 * and the create-command path-log already do).
	 */
	filePath?: string;
	rawContent: string;
	/**
	 * Most recent previous id this task had, if the namespace backend
	 * auto-renumbered it on a push collision. Surfaced as a
	 * "previously known as X" banner in the UIs. Populated only by the
	 * namespace backend (it reads the state ref's audit log on each
	 * `get`/`list`); file and hybrid leave it `undefined`.
	 */
	renamed_from?: string;
}

export interface TaskCreateInput {
	title: string;
	status?: string;
	assignee?: string | null;
	priority?: Priority | null;
	tags?: string[];
	depends_on?: string[];
	body?: string;
}

export interface TaskUpdateInput {
	title?: string;
	status?: string;
	assignee?: string | null;
	priority?: Priority | null;
	tags?: string[];
	depends_on?: string[];
	sections?: Section[];
}

export const FRONTMATTER_ALIASES: Record<string, string[]> = {
	tags: ["tags", "labels"],
	depends_on: ["depends_on", "dependencies"],
	created_at: ["created_at", "createdDate", "created"],
	updated_at: ["updated_at", "updatedDate", "updated"],
	assignee: ["assignee"],
	priority: ["priority"],
	status: ["status"],
	title: ["title"],
	id: ["id"],
	attachments: ["attachments"],
};

export const ORDNA_BODY_HEADINGS = {
	description: "Goal",
	acceptance_criteria: "Acceptance Criteria",
	notes: "Notes",
	progress: "Progress",
} as const;

export const BACKLOG_BODY_HEADINGS = {
	description: "Description",
	acceptance_criteria: "Acceptance Criteria",
	implementation_plan: "Implementation Plan",
	implementation_notes: "Implementation Notes",
	final_summary: "Final Summary",
} as const;

export const BODY_HEADING_ALIASES: Record<string, string[]> = {
	description: ["Goal", "Description"],
	acceptance_criteria: ["Acceptance Criteria"],
	notes: ["Notes", "Implementation Notes"],
	progress: ["Progress", "Final Summary"],
	implementation_plan: ["Implementation Plan"],
};

export const priorityEnum = z.enum(["high", "medium", "low"]);

export const frontmatterSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		status: z.string(),
		assignee: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
		priority: priorityEnum.nullable().optional(),
		tags: z.array(z.string()).optional(),
		labels: z.array(z.string()).optional(),
		depends_on: z.array(z.string()).optional(),
		dependencies: z.array(z.string()).optional(),
		created_at: z.union([z.string(), z.date()]).optional(),
		createdDate: z.union([z.string(), z.date()]).optional(),
		updated_at: z.union([z.string(), z.date()]).optional(),
		updatedDate: z.union([z.string(), z.date()]).optional(),
		attachments: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					type: z.string().nullable().optional(),
					size: z.number().optional(),
					// gray-matter coerces unquoted `YYYY-MM-DD` to a Date,
					// same as created_at/updated_at — accept both.
					added: z.union([z.string(), z.date()]).optional(),
					src: z.string(),
				}),
			)
			.optional(),
	})
	.passthrough();

export type RawFrontmatter = z.infer<typeof frontmatterSchema>;

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
	sections: Section[];
	extra_frontmatter: Record<string, unknown>;
	filePath: string;
	rawContent: string;
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
	})
	.passthrough();

export type RawFrontmatter = z.infer<typeof frontmatterSchema>;

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { SchemaMode } from "./schema.js";

export const configSchema = z.object({
	tasksDir: z.string().default("tasks"),
	schema: z.enum(["ordna", "backlog"]).default("ordna"),
	statuses: z.array(z.string()).min(1).default(["todo", "doing", "done"]),
	idPrefix: z.string().default("T"),
	zeroPaddedIds: z.number().int().min(0).max(10).default(3),
	webPort: z.number().int().min(1).max(65535).default(7420),
	// T-031: storage mode selector. "file" (current default) keeps the
	// existing on-disk layout. "hybrid" adds a sync ref for the next-id
	// allocator + audit log. "namespace" (T-032) stores tasks as git
	// blobs under `refs/ordna/tasks/<id>` with no working-tree presence.
	storage: z.enum(["file", "hybrid", "namespace"]).default("file"),
	// T-032: namespace-mode tuning. Polling interval for the watcher
	// (refs have no kernel-level change-notification path, so polling
	// is the only reliable mechanism). Default 1s. `autoFetchIntervalMs`
	// runs `git fetch origin '+refs/ordna/tasks/*:refs/ordna/tasks/*'`
	// in the background so other machines' updates land without manual
	// pulls; set to 0 to disable auto-fetch entirely (manual fetch via
	// the TUI / web button still works). `autoRenumberOnConflict`
	// controls whether a push-rejection on a colliding create silently
	// reallocates a fresh ID for the local task (true, default) or
	// surfaces a loud error (false, for projects where stable IDs in
	// commit messages / external links are load-bearing).
	namespace: z
		.object({
			pollIntervalMs: z.number().int().min(50).default(1000),
			autoFetchIntervalMs: z.number().int().min(0).default(60000),
			autoRenumberOnConflict: z.boolean().default(true),
		})
		.default({
			pollIntervalMs: 1000,
			autoFetchIntervalMs: 60000,
			autoRenumberOnConflict: true,
		}),
	// T-035: attachment tuning. `maxSizeMb` caps a single attachment's
	// size — attachments land in git (working-tree files or blobs), so
	// an accidental multi-GB drop would bloat the repo forever. Enforced
	// in core (`addAttachment`) so CLI / TUI / web all respect it; the
	// web server also pre-checks before buffering the upload. Set to 0
	// to disable the limit entirely.
	attachments: z
		.object({
			maxSizeMb: z.number().min(0).default(25),
		})
		.default({ maxSizeMb: 25 }),
});

export type OrdnaConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: OrdnaConfig = configSchema.parse({});

const CONFIG_PATH = ".ordna/config.yaml";

export interface LoadConfigOptions {
	cwd?: string;
	overrides?: Partial<OrdnaConfig>;
}

export function loadConfig(options: LoadConfigOptions = {}): OrdnaConfig {
	const cwd = options.cwd ?? process.cwd();
	const configFile = join(cwd, CONFIG_PATH);

	let fromFile: unknown = {};
	if (existsSync(configFile)) {
		const raw = readFileSync(configFile, "utf8");
		fromFile = parseYaml(raw) ?? {};
	}

	const merged: Record<string, unknown> = {
		...(fromFile as object),
		...(options.overrides ?? {}),
	};

	// T-033: `ORDNA_STORAGE` is a runtime override — when set to one of
	// the known modes, it wins over whatever the YAML says. CI uses
	// this to pin storage without writing a file; tests use it to
	// exercise specific modes without polluting the test directory.
	const envStorage = process.env.ORDNA_STORAGE;
	if (envStorage === "file" || envStorage === "hybrid" || envStorage === "namespace") {
		merged.storage = envStorage;
	}

	return configSchema.parse(merged);
}

export function resolveTasksDir(config: OrdnaConfig, cwd = process.cwd()): string {
	return join(cwd, config.tasksDir);
}

export function resolveSchemaMode(config: OrdnaConfig): SchemaMode {
	return config.schema;
}

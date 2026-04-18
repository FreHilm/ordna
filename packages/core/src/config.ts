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

	const merged = { ...(fromFile as object), ...(options.overrides ?? {}) };
	return configSchema.parse(merged);
}

export function resolveTasksDir(config: OrdnaConfig, cwd = process.cwd()): string {
	return join(cwd, config.tasksDir);
}

export function resolveSchemaMode(config: OrdnaConfig): SchemaMode {
	return config.schema;
}

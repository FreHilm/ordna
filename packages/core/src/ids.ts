import { readdirSync } from "node:fs";
import type { OrdnaConfig } from "./config.js";

export function formatId(config: OrdnaConfig, numeric: number): string {
	const padded =
		config.zeroPaddedIds > 0 ? String(numeric).padStart(config.zeroPaddedIds, "0") : String(numeric);
	return `${config.idPrefix}-${padded}`;
}

export function parseId(config: OrdnaConfig, id: string): number | null {
	const prefix = `${config.idPrefix}-`;
	if (!id.startsWith(prefix)) return null;
	const rest = id.slice(prefix.length);
	const n = Number.parseInt(rest, 10);
	return Number.isFinite(n) ? n : null;
}

export function extractIdFromFilename(config: OrdnaConfig, filename: string): number | null {
	const withoutExt = filename.replace(/\.md$/i, "");
	const ordna = parseId(config, withoutExt);
	if (ordna !== null) return ordna;

	const backlogMatch = withoutExt.match(/^task-(\d+)\b/);
	if (backlogMatch?.[1]) {
		const n = Number.parseInt(backlogMatch[1], 10);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

export function nextId(config: OrdnaConfig, tasksDir: string): string {
	let max = 0;
	try {
		const entries = readdirSync(tasksDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const n = extractIdFromFilename(config, entry.name);
			if (n !== null && n > max) max = n;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return formatId(config, max + 1);
}

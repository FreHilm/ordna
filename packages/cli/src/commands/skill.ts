import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { c } from "../colors.js";

export interface SkillInstallOptions {
	out?: string;
	from?: string;
	force?: boolean;
	cwd?: string;
}

const DEFAULT_OUT = "AGENTS.md";

function resolveBundledTemplate(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "..", "..", "templates", "AGENTS.md");
}

async function loadFromUrl(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
	}
	return await res.text();
}

function loadBundled(): string {
	const path = resolveBundledTemplate();
	if (!existsSync(path)) {
		throw new Error(`bundled skill template missing at ${path}`);
	}
	return readFileSync(path, "utf8");
}

export async function runSkillInstall(options: SkillInstallOptions = {}): Promise<void> {
	const cwd = options.cwd ?? process.cwd();
	const outPath = resolve(cwd, options.out ?? DEFAULT_OUT);

	if (existsSync(outPath) && !options.force) {
		console.error(c.red(`refusing to overwrite ${outPath} (pass --force to overwrite)`));
		process.exitCode = 1;
		return;
	}

	let content: string;
	let source: string;
	try {
		if (options.from) {
			content = await loadFromUrl(options.from);
			source = options.from;
		} else {
			content = loadBundled();
			source = "bundled template";
		}
	} catch (err) {
		console.error(c.red(`skill install failed: ${(err as Error).message}`));
		process.exitCode = 1;
		return;
	}

	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, content, "utf8");
	console.log(c.green("Installed Ordna agent skill."));
	console.log(c.dim(`  source: ${source}`));
	console.log(c.dim(`  wrote:  ${outPath}`));
}

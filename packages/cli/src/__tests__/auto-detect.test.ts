import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, "../../dist/bin/ordna.js");

function run(
	cwd: string,
	args: string[],
	env: NodeJS.ProcessEnv = {},
): { stdout: string; stderr: string; code: number } {
	const result = spawnSync("node", [CLI_BIN, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1", ...env },
	});
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		code: result.status ?? -1,
	};
}

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
});

function mkGitRepoNoConfig(): string {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-cli-autodetect-"));
	tmpDirs.push(cwd);
	// `git init` so the directory looks like a real project; no
	// .ordna/config.yaml so the CLI hits the ask-branch.
	spawnSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd });
	spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
	spawnSync("git", ["config", "user.name", "Ordna Test"], { cwd });
	return cwd;
}

describe("CLI auto-detect — non-TTY behaviour", () => {
	beforeAll(() => {
		if (!existsSync(CLI_BIN)) {
			throw new Error(
				`Build missing: ${CLI_BIN}. Run \`pnpm --filter @frehilm/ordna-cli build\`.`,
			);
		}
	});

	it("fails fast with a helpful hint when no config + git repo + non-TTY", () => {
		const cwd = mkGitRepoNoConfig();
		const r = run(cwd, ["list"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toMatch(/No \.ordna\/config\.yaml found.*isn't an interactive shell/);
		expect(r.stderr).toMatch(/ORDNA_STORAGE=file\|hybrid\|namespace/);
		// And: NO config file was written.
		expect(existsSync(join(cwd, ".ordna", "config.yaml"))).toBe(false);
	});

	it("ORDNA_STORAGE=file skips the prompt entirely and runs successfully", () => {
		const cwd = mkGitRepoNoConfig();
		const r = run(cwd, ["list"], { ORDNA_STORAGE: "file" });
		expect(r.code).toBe(0);
		// "No tasks. Create one with..." or similar empty-board message
		// is fine; the point is we didn't hit the ask-branch error.
		expect(r.stderr).not.toMatch(/isn't an interactive shell/);
		// Env var is runtime-only — no config file written.
		expect(existsSync(join(cwd, ".ordna", "config.yaml"))).toBe(false);
	});

	it("auto-detects file mode and writes config when tasks/*.md exists", () => {
		const cwd = mkGitRepoNoConfig();
		// Place a markdown task on disk; auto-detect should pick `file`.
		const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
		mkdirSync(join(cwd, "tasks"));
		writeFileSync(
			join(cwd, "tasks", "T-001.md"),
			[
				"---",
				"id: T-001",
				"title: Existing task",
				"status: todo",
				"assignee: null",
				"priority: null",
				"tags: []",
				"depends_on: []",
				"created_at: 2026-06-09",
				"updated_at: 2026-06-09",
				"---",
				"",
				"## Goal",
				"",
			].join("\n"),
			"utf8",
		);
		const r = run(cwd, ["list"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("T-001");
		// Config was written by ensureStorageConfig because detection
		// landed on `file`.
		const configPath = join(cwd, ".ordna", "config.yaml");
		expect(existsSync(configPath)).toBe(true);
		expect(readFileSync(configPath, "utf8")).toContain("storage: file");
	});

	it("`ordna init --storage=hybrid` writes the config and creates tasks/", () => {
		const cwd = mkGitRepoNoConfig();
		const r = run(cwd, ["init", "--storage=hybrid"]);
		expect(r.code).toBe(0);
		const configPath = join(cwd, ".ordna", "config.yaml");
		expect(existsSync(configPath)).toBe(true);
		expect(readFileSync(configPath, "utf8")).toContain("storage: hybrid");
		expect(existsSync(join(cwd, "tasks"))).toBe(true);
	});

	it("`ordna init --storage=namespace` writes the config and does NOT create tasks/", () => {
		const cwd = mkGitRepoNoConfig();
		const r = run(cwd, ["init", "--storage=namespace"]);
		expect(r.code).toBe(0);
		const configPath = join(cwd, ".ordna", "config.yaml");
		expect(existsSync(configPath)).toBe(true);
		expect(readFileSync(configPath, "utf8")).toContain("storage: namespace");
		expect(existsSync(join(cwd, "tasks"))).toBe(false);
	});

	it("`ordna init` is a no-op when a config already exists", () => {
		const cwd = mkGitRepoNoConfig();
		// First init.
		run(cwd, ["init", "--storage=file"]);
		const first = readFileSync(join(cwd, ".ordna", "config.yaml"), "utf8");
		// Second init — should not overwrite.
		const r = run(cwd, ["init", "--storage=hybrid"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/already initialized/i);
		expect(readFileSync(join(cwd, ".ordna", "config.yaml"), "utf8")).toBe(
			first,
		);
	});
});

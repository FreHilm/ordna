import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, "../../dist/bin/ordna.js");

function run(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
	const result = spawnSync("node", [CLI_BIN, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1" },
	});
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		code: result.status ?? -1,
	};
}

describe("ordna CLI", () => {
	let cwd: string;

	beforeAll(() => {
		if (!existsSync(CLI_BIN)) {
			throw new Error(`Build missing: ${CLI_BIN}. Run \`pnpm --filter @ordna/cli build\`.`);
		}
		cwd = mkdtempSync(join(tmpdir(), "ordna-cli-"));
	});

	it("init creates config and tasks dir", () => {
		const r = run(cwd, ["init"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("Initialized Ordna");
		expect(existsSync(join(cwd, ".ordna", "config.yaml"))).toBe(true);
		expect(existsSync(join(cwd, "tasks"))).toBe(true);
	});

	it("create produces a T-001.md file", () => {
		const r = run(cwd, ["create", "Implement", "payment", "flow", "-p", "high", "-t", "payments"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("T-001");
		const file = readFileSync(join(cwd, "tasks", "T-001.md"), "utf8");
		expect(file).toContain("id: T-001");
		expect(file).toContain("priority: high");
		expect(file).toContain("- payments");
	});

	it("create with -d wires depends_on", () => {
		const r = run(cwd, ["create", "Write", "tests", "-d", "T-001"]);
		expect(r.code).toBe(0);
		const file = readFileSync(join(cwd, "tasks", "T-002.md"), "utf8");
		expect(file).toContain("- T-001");
	});

	it("list shows both tasks with status summary", () => {
		const r = run(cwd, ["list"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("T-001");
		expect(r.stdout).toContain("T-002");
		expect(r.stdout).toContain("todo: 2");
	});

	it("move respects depends_on gate", () => {
		const blocked = run(cwd, ["move", "T-002", "done"]);
		expect(blocked.code).toBe(1);
		expect(blocked.stderr).toContain("dependencies not done");

		const depDone = run(cwd, ["move", "T-001", "done"]);
		expect(depDone.code).toBe(0);
		const finalMove = run(cwd, ["move", "T-002", "done"]);
		expect(finalMove.code).toBe(0);
	});

	it("assign sets and clears the assignee", () => {
		const assigned = run(cwd, ["assign", "T-001", "fredrik"]);
		expect(assigned.code).toBe(0);
		expect(readFileSync(join(cwd, "tasks", "T-001.md"), "utf8")).toContain("assignee: fredrik");

		const unassigned = run(cwd, ["assign", "T-001"]);
		expect(unassigned.code).toBe(0);
		expect(readFileSync(join(cwd, "tasks", "T-001.md"), "utf8")).toContain("assignee: null");
	});

	it("show prints the task body", () => {
		const r = run(cwd, ["show", "T-001"]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("Implement payment flow");
		expect(r.stdout).toContain("## Goal");
	});

	it("show exits 1 on unknown id", () => {
		const r = run(cwd, ["show", "T-999"]);
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("not found");
	});
});

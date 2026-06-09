import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContext } from "../store.js";

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
});

function makeProject(configBody: string): string {
	const cwd = mkdtempSync(join(tmpdir(), "ordna-hybrid-config-"));
	tmpDirs.push(cwd);
	mkdirSync(join(cwd, ".ordna"), { recursive: true });
	writeFileSync(join(cwd, ".ordna", "config.yaml"), configBody, "utf8");
	return cwd;
}

describe("createContext config validation for storage modes", () => {
	it("rejects `storage: hybrid` outside a git repository with a clear hint", () => {
		const cwd = makeProject("storage: hybrid\n");
		expect(() => createContext(cwd)).toThrow(/storage: hybrid.*requires a git repository/);
	});

	it("rejects `storage: hybrid` combined with `schema: backlog`", () => {
		// Make it a git repo first so we hit the schema check, not the git check.
		const cwd = makeProject("storage: hybrid\nschema: backlog\n");
		mkdirSync(join(cwd, ".git"));
		expect(() => createContext(cwd)).toThrow(/`storage: hybrid` is not supported with `schema: backlog`/);
	});

	it("rejects `storage: namespace` for now (T-032)", () => {
		const cwd = makeProject("storage: namespace\n");
		mkdirSync(join(cwd, ".git"));
		expect(() => createContext(cwd)).toThrow(/storage: namespace.*not yet implemented/);
	});

	it("accepts `storage: hybrid` + `schema: ordna` inside a git repo", () => {
		const cwd = makeProject("storage: hybrid\nschema: ordna\n");
		mkdirSync(join(cwd, ".git"));
		const ctx = createContext(cwd);
		expect(ctx.backend.kind).toBe("hybrid");
	});

	it("falls back to file mode for an empty config (default)", () => {
		const cwd = makeProject(""); // empty config — schema defaults apply
		const ctx = createContext(cwd);
		expect(ctx.backend.kind).toBe("file");
	});
});

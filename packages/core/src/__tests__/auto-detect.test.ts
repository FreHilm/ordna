import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	detectStorageMode,
	ensureStorageConfig,
	NeedsModeSelection,
} from "../storage/auto-detect.js";
import { GitRunner } from "../storage/git-ref.js";

const tmpDirs: string[] = [];
const ORIGINAL_ORDNA_STORAGE = process.env.ORDNA_STORAGE;

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
	if (ORIGINAL_ORDNA_STORAGE === undefined) {
		delete process.env.ORDNA_STORAGE;
	} else {
		process.env.ORDNA_STORAGE = ORIGINAL_ORDNA_STORAGE;
	}
});

beforeEach(() => {
	delete process.env.ORDNA_STORAGE;
});

function mkTmp(label: string): string {
	const cwd = mkdtempSync(join(tmpdir(), `ordna-${label}-`));
	tmpDirs.push(cwd);
	return cwd;
}

async function mkGitRepo(label: string): Promise<{ cwd: string; git: GitRunner }> {
	const cwd = mkTmp(label);
	const git = new GitRunner(cwd);
	await git.run(["init", "--initial-branch=main", "--quiet"]);
	await git.run(["config", "user.email", "test@example.com"]);
	await git.run(["config", "user.name", "Ordna Test"]);
	return { cwd, git };
}

describe("detectStorageMode — all five paths", () => {
	it("returns `namespace` when refs/ordna/tasks/* exist", async () => {
		const { cwd, git } = await mkGitRepo("detect-namespace");
		const oid = await git.hashObject("dummy");
		await git.updateRef("refs/ordna/tasks/T-001", oid, "");

		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("namespace");
		expect(detected.reason).toContain("refs/ordna/tasks/");
	});

	it("returns `hybrid` when refs/ordna/state exists (and no namespace refs)", async () => {
		const { cwd, git } = await mkGitRepo("detect-hybrid");
		const oid = await git.hashObject("{}");
		await git.updateRef("refs/ordna/state", oid, "");

		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("hybrid");
		expect(detected.reason).toContain("refs/ordna/state");
	});

	it("returns `file` when tasks/*.md exists (and no ordna refs)", async () => {
		const { cwd } = await mkGitRepo("detect-file");
		mkdirSync(join(cwd, "tasks"));
		writeFileSync(join(cwd, "tasks", "T-001.md"), "# T-001\n", "utf8");

		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("file");
		expect(detected.reason).toContain("tasks/*.md");
	});

	it("returns `ask` when cwd is a git repo with no storage signals", async () => {
		const { cwd } = await mkGitRepo("detect-ask");

		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("ask");
	});

	it("returns `default-file` when there is no git and no storage signals", async () => {
		const cwd = mkTmp("detect-default");

		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("default-file");
	});

	it("prefers namespace over file when both signals exist (refs are authoritative)", async () => {
		const { cwd, git } = await mkGitRepo("detect-precedence");
		// Set up both signals — should never happen normally but the
		// edge case is documented in the spec.
		mkdirSync(join(cwd, "tasks"));
		writeFileSync(join(cwd, "tasks", "T-001.md"), "stale\n", "utf8");
		const oid = await git.hashObject("dummy");
		await git.updateRef("refs/ordna/tasks/T-001", oid, "");

		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("namespace");
	});

	it("ignores `tasks/` if it exists but contains no .md files", async () => {
		const { cwd } = await mkGitRepo("detect-empty-tasks-dir");
		mkdirSync(join(cwd, "tasks"));
		// no .md files inside
		const detected = await detectStorageMode(cwd);
		expect(detected.mode).toBe("ask"); // git repo, no real signals
	});
});

describe("ensureStorageConfig — write vs throw vs short-circuit", () => {
	it("writes the detected mode to .ordna/config.yaml for confident detections", async () => {
		const { cwd, git } = await mkGitRepo("ensure-write-namespace");
		const oid = await git.hashObject("dummy");
		await git.updateRef("refs/ordna/tasks/T-001", oid, "");

		await ensureStorageConfig(cwd);

		const configPath = join(cwd, ".ordna", "config.yaml");
		expect(existsSync(configPath)).toBe(true);
		const body = readFileSync(configPath, "utf8");
		expect(body).toContain("storage: namespace");
	});

	it("throws NeedsModeSelection for the `ask` branch", async () => {
		const { cwd } = await mkGitRepo("ensure-ask");

		await expect(ensureStorageConfig(cwd)).rejects.toBeInstanceOf(
			NeedsModeSelection,
		);
	});

	it("does NOT write for the `default-file` branch (non-git directory)", async () => {
		const cwd = mkTmp("ensure-default");
		await ensureStorageConfig(cwd);
		expect(existsSync(join(cwd, ".ordna", "config.yaml"))).toBe(false);
	});

	it("is a no-op when .ordna/config.yaml already exists", async () => {
		const { cwd } = await mkGitRepo("ensure-existing");
		mkdirSync(join(cwd, ".ordna"));
		const customConfig = "storage: namespace\n# user wrote this\n";
		writeFileSync(join(cwd, ".ordna", "config.yaml"), customConfig, "utf8");

		await ensureStorageConfig(cwd);

		// Config not overwritten.
		expect(readFileSync(join(cwd, ".ordna", "config.yaml"), "utf8")).toBe(
			customConfig,
		);
	});

	it("ORDNA_STORAGE env var short-circuits detection and skips writing", async () => {
		const { cwd } = await mkGitRepo("ensure-env-override");
		process.env.ORDNA_STORAGE = "namespace";

		await ensureStorageConfig(cwd);

		// No config written — env var is runtime-only.
		expect(existsSync(join(cwd, ".ordna", "config.yaml"))).toBe(false);
	});

	it("ORDNA_STORAGE with an invalid value falls through to normal detection", async () => {
		const { cwd } = await mkGitRepo("ensure-env-invalid");
		process.env.ORDNA_STORAGE = "garbage";

		// "ask" branch fires because invalid env value is ignored.
		await expect(ensureStorageConfig(cwd)).rejects.toBeInstanceOf(
			NeedsModeSelection,
		);
	});
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseTask } from "../parser.js";
import { inferMediaType, nextAttachmentId, sanitizeFilename } from "../storage/attachments.js";
import { GitRunner } from "../storage/git-ref.js";
import {
	addAttachment,
	canAttach,
	createContext,
	createTask,
	deleteTask,
	getTask,
	readAttachment,
	removeAttachment,
} from "../store.js";
import { makeTempRepo } from "./helpers.js";

const tmpDirs: string[] = [];

afterEach(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
	tmpDirs.length = 0;
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("attachment pure helpers", () => {
	it("infers media type from extension, null when unknown", () => {
		expect(inferMediaType("chart.png")).toBe("image/png");
		expect(inferMediaType("doc.PDF")).toBe("application/pdf");
		expect(inferMediaType("notes")).toBeNull();
		expect(inferMediaType("data.weirdext")).toBeNull();
	});

	it("sanitizes filenames (strips paths, collapses junk, never empty)", () => {
		expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
		expect(sanitizeFilename("my report (final).png")).toBe("my-report-final-.png");
		expect(sanitizeFilename("////")).toBe("file");
	});

	it("allocates ids as max+1, never recycling gaps", () => {
		expect(nextAttachmentId([])).toBe("a1");
		expect(
			nextAttachmentId([
				{ id: "a1", name: "x", type: null, size: 0, added: "", src: "" },
				{ id: "a3", name: "y", type: null, size: 0, added: "", src: "" },
			]),
		).toBe("a4");
	});
});

describe("attachments — frontmatter round-trip", () => {
	it("serializes and re-parses attachment records", () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		// build via the backend so we exercise the real write path
		return (async () => {
			const t = await createTask({ title: "Has files" }, ctx);
			await addAttachment(t.id, { name: "chart.png", bytes: PNG }, ctx);
			const raw = readFileSync(t.filePath, "utf8");
			expect(raw).toContain("attachments:");
			const reparsed = parseTask(raw, t.filePath);
			expect(reparsed.attachments).toHaveLength(1);
			expect(reparsed.attachments[0]?.name).toBe("chart.png");
			expect(reparsed.attachments[0]?.type).toBe("image/png");
		})();
	});

	it("omits the attachments key entirely when there are none", () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		return (async () => {
			const t = await createTask({ title: "No files" }, ctx);
			const raw = readFileSync(t.filePath, "utf8");
			expect(raw).not.toContain("attachments:");
		})();
	});
});

describe("attachments — file backend", () => {
	it("add stores bytes under tasks/attachments/<id>/ and registers metadata", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		expect(canAttach(ctx)).toBe(true);

		const t = await createTask({ title: "Task" }, ctx);
		const att = await addAttachment(t.id, { name: "chart.png", bytes: PNG }, ctx);

		expect(att.id).toBe("a1");
		expect(att.size).toBe(PNG.byteLength);
		expect(att.src).toBe("attachments/T-001/a1-chart.png");

		const onDisk = join(repo.tasksDir, att.src);
		expect(existsSync(onDisk)).toBe(true);
		expect(readFileSync(onDisk)).toEqual(PNG);

		const reloaded = await getTask(t.id, ctx);
		expect(reloaded?.attachments).toHaveLength(1);
	});

	it("read returns the exact bytes plus metadata", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "Task" }, ctx);
		const att = await addAttachment(t.id, { name: "a.bin", bytes: PNG }, ctx);

		const { meta, bytes } = await readAttachment(t.id, att.id, ctx);
		expect(bytes).toEqual(PNG);
		expect(meta.id).toBe(att.id);
	});

	it("remove deletes the file and the registry entry", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "Task" }, ctx);
		const att = await addAttachment(t.id, { name: "a.png", bytes: PNG }, ctx);
		const onDisk = join(repo.tasksDir, att.src);

		await removeAttachment(t.id, att.id, ctx);
		expect(existsSync(onDisk)).toBe(false);
		const reloaded = await getTask(t.id, ctx);
		expect(reloaded?.attachments).toEqual([]);
	});

	it("supports multiple attachments with stable ids", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "Task" }, ctx);
		const a1 = await addAttachment(t.id, { name: "one.png", bytes: PNG }, ctx);
		const a2 = await addAttachment(t.id, { name: "two.png", bytes: PNG }, ctx);
		expect([a1.id, a2.id]).toEqual(["a1", "a2"]);

		await removeAttachment(t.id, "a1", ctx);
		const a3 = await addAttachment(t.id, { name: "three.png", bytes: PNG }, ctx);
		// a1 removed, max remaining is a2 → next is a3 (no recycle of a1)
		expect(a3.id).toBe("a3");
	});

	it("read throws for an unknown attachment id", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "Task" }, ctx);
		await expect(readAttachment(t.id, "a99", ctx)).rejects.toThrow(/not found/);
	});

	it("deleting a task removes its attachment directory", async () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		const t = await createTask({ title: "Task" }, ctx);
		await addAttachment(t.id, { name: "a.png", bytes: PNG }, ctx);
		const attDir = join(repo.tasksDir, "attachments", t.id);
		expect(existsSync(attDir)).toBe(true);

		await deleteTask(t.id, ctx);
		expect(existsSync(attDir)).toBe(false);
	});
});

describe("attachments — size cap (attachments.maxSizeMb)", () => {
	function makeCappedRepo(maxSizeMb: number): string {
		const cwd = mkdtempSync(join(tmpdir(), "ordna-att-cap-"));
		tmpDirs.push(cwd);
		mkdirSync(join(cwd, ".ordna"), { recursive: true });
		writeFileSync(
			join(cwd, ".ordna", "config.yaml"),
			`tasksDir: tasks\nschema: ordna\nattachments:\n  maxSizeMb: ${maxSizeMb}\n`,
			"utf8",
		);
		return cwd;
	}

	it("rejects an attachment above the configured limit", async () => {
		const ctx = createContext(makeCappedRepo(1));
		const t = await createTask({ title: "Task" }, ctx);
		const big = Buffer.alloc(1.5 * 1024 * 1024);
		await expect(addAttachment(t.id, { name: "big.bin", bytes: big }, ctx)).rejects.toThrow(
			/limit is 1 MB/,
		);
		// nothing written, registry untouched
		expect((await getTask(t.id, ctx))?.attachments).toEqual([]);
	});

	it("maxSizeMb: 0 disables the cap", async () => {
		const ctx = createContext(makeCappedRepo(0));
		const t = await createTask({ title: "Task" }, ctx);
		const big = Buffer.alloc(1.5 * 1024 * 1024);
		const att = await addAttachment(t.id, { name: "big.bin", bytes: big }, ctx);
		expect(att.size).toBe(big.byteLength);
	});

	it("default config caps at 25 MB", () => {
		const repo = makeTempRepo("ordna");
		const ctx = createContext(repo.cwd);
		expect(ctx.config.attachments.maxSizeMb).toBe(25);
	});
});

async function setupGitRepo(prefix: string, configBody: string): Promise<string> {
	const cwd = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(cwd);
	const git = new GitRunner(cwd);
	await git.run(["init", "--initial-branch=main", "--quiet"]);
	await git.run(["config", "user.email", "test@example.com"]);
	await git.run(["config", "user.name", "Ordna Test"]);
	mkdirSync(join(cwd, ".ordna"), { recursive: true });
	writeFileSync(join(cwd, ".ordna", "config.yaml"), configBody, "utf8");
	return cwd;
}

describe("attachments — hybrid backend", () => {
	it("stores bytes as working-tree files like file mode", async () => {
		const cwd = await setupGitRepo("ordna-att-hybrid-", "storage: hybrid\nschema: ordna\n");
		const ctx = createContext(cwd);
		expect(ctx.backend.kind).toBe("hybrid");
		expect(canAttach(ctx)).toBe(true);

		const t = await createTask({ title: "Task" }, ctx);
		const att = await addAttachment(t.id, { name: "x.png", bytes: PNG }, ctx);
		expect(existsSync(join(cwd, "tasks", att.src))).toBe(true);

		const { bytes } = await readAttachment(t.id, att.id, ctx);
		expect(bytes).toEqual(PNG);

		await removeAttachment(t.id, att.id, ctx);
		expect((await getTask(t.id, ctx))?.attachments).toEqual([]);
		await ctx.backend.dispose();
	});

	it("deleting a task removes its attachment directory", async () => {
		const cwd = await setupGitRepo("ordna-att-hybrid-del-", "storage: hybrid\nschema: ordna\n");
		const ctx = createContext(cwd);
		const t = await createTask({ title: "Task" }, ctx);
		await addAttachment(t.id, { name: "a.png", bytes: PNG }, ctx);
		const attDir = join(cwd, "tasks", "attachments", t.id);
		expect(existsSync(attDir)).toBe(true);

		await deleteTask(t.id, ctx);
		expect(existsSync(attDir)).toBe(false);
		await ctx.backend.dispose();
	});
});

describe("attachments — namespace backend", () => {
	it("round-trips bytes via git blobs, anchored by a ref, no working tree", async () => {
		const cwd = await setupGitRepo(
			"ordna-att-ns-",
			"storage: namespace\nschema: ordna\nnamespace:\n  autoFetchIntervalMs: 0\n",
		);
		const ctx = createContext(cwd);
		expect(ctx.backend.kind).toBe("namespace");
		expect(canAttach(ctx)).toBe(true);
		const git = new GitRunner(cwd);

		const t = await createTask({ title: "Task" }, ctx);
		const att = await addAttachment(t.id, { name: "chart.png", bytes: PNG }, ctx);
		expect(att.src.startsWith("git:")).toBe(true);

		// Anchored by a ref so gc can't prune it.
		const refs = await git.forEachRef(`refs/ordna/attachments/${t.id}/a1`);
		expect(refs).toHaveLength(1);

		// Metadata is on the task blob; bytes come back intact.
		const reloaded = await getTask(t.id, ctx);
		expect(reloaded?.attachments).toHaveLength(1);
		const { bytes } = await readAttachment(t.id, att.id, ctx);
		expect(bytes).toEqual(PNG);

		// No working-tree files leaked.
		expect(existsSync(join(cwd, "tasks"))).toBe(false);

		await removeAttachment(t.id, att.id, ctx);
		expect((await getTask(t.id, ctx))?.attachments).toEqual([]);
		const refsAfter = await git.forEachRef(`refs/ordna/attachments/${t.id}/a1`);
		expect(refsAfter).toHaveLength(0);

		await ctx.backend.dispose();
	});

	it("deleting a task removes its attachment anchor refs", async () => {
		const cwd = await setupGitRepo(
			"ordna-att-ns-del-",
			"storage: namespace\nschema: ordna\nnamespace:\n  autoFetchIntervalMs: 0\n",
		);
		const ctx = createContext(cwd);
		const git = new GitRunner(cwd);

		const t = await createTask({ title: "Task" }, ctx);
		await addAttachment(t.id, { name: "one.png", bytes: PNG }, ctx);
		await addAttachment(t.id, { name: "two.png", bytes: PNG }, ctx);
		expect(await git.forEachRef(`refs/ordna/attachments/${t.id}/*`)).toHaveLength(2);

		await deleteTask(t.id, ctx);
		expect(await git.forEachRef(`refs/ordna/attachments/${t.id}/*`)).toHaveLength(0);

		await ctx.backend.dispose();
	});
});

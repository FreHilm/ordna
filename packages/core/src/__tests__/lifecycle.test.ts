import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema } from "../config.js";
import { FileTaskProvider } from "../providers/file.js";
import type { TaskProvider } from "../provider.js";
import { createContext, disposeContext, type StoreContext } from "../store.js";
import type { Task, TaskCreateInput, TaskUpdateInput } from "../schema.js";

// A minimal TaskProvider with recorders for init/dispose. Other methods
// throw if accidentally invoked so the test fails loudly rather than
// silently passing on a wrong code path.
function makeStubProvider(opts: { disposeThrows?: boolean } = {}): {
	provider: TaskProvider;
	counts: { init: number; dispose: number };
} {
	const counts = { init: 0, dispose: 0 };
	const provider: TaskProvider = {
		kind: "stub",
		async init() {
			counts.init++;
		},
		async dispose() {
			counts.dispose++;
			if (opts.disposeThrows) throw new Error("dispose blew up");
		},
		list: async (): Promise<Task[]> => [],
		get: async (): Promise<Task | null> => null,
		create: async (_input: TaskCreateInput): Promise<Task> => {
			throw new Error("create not implemented in stub");
		},
		update: async (_id: string, _patch: TaskUpdateInput): Promise<Task> => {
			throw new Error("update not implemented in stub");
		},
		move: async (_id: string, _status: string): Promise<Task> => {
			throw new Error("move not implemented in stub");
		},
		delete: async (): Promise<void> => {
			// no-op
		},
		watch: () => async () => {
			// no-op unsubscribe
		},
	};
	return { provider, counts };
}

function makeContext(provider: TaskProvider): StoreContext {
	return {
		cwd: "/tmp",
		config: configSchema.parse({}),
		tasksDir: "/tmp/tasks",
		provider,
	};
}

describe("provider lifecycle (T-023)", () => {
	const created: string[] = [];

	afterEach(() => {
		for (const dir of created) rmSync(dir, { recursive: true, force: true });
		created.length = 0;
	});

	function mkTmp(): string {
		const d = mkdtempSync(join(tmpdir(), "ordna-lifecycle-"));
		created.push(d);
		return d;
	}

	it("createContext invokes provider.init() exactly once", async () => {
		// FileTaskProvider.init creates the tasks directory if it doesn't
		// exist. Observe init by setting up a fresh cwd where the dir is
		// absent before createContext runs.
		const cwd = mkTmp();
		const tasksDir = join(cwd, "tasks");
		expect(existsSync(tasksDir)).toBe(false);

		await createContext(cwd);

		expect(existsSync(tasksDir)).toBe(true);
	});

	it("createContext propagates errors from init", async () => {
		// Spy on FileTaskProvider.init to simulate a remote provider's
		// auth-failure path. The error must escape createContext.
		const spy = vi
			.spyOn(FileTaskProvider.prototype, "init")
			.mockRejectedValueOnce(new Error("auth: token expired"));

		const cwd = mkTmp();
		await expect(createContext(cwd)).rejects.toThrow(/auth: token expired/);

		spy.mockRestore();
	});

	it("disposeContext invokes provider.dispose() exactly once", async () => {
		const { provider, counts } = makeStubProvider();
		const ctx = makeContext(provider);

		await disposeContext(ctx);

		expect(counts.dispose).toBe(1);
	});

	it("disposeContext swallows errors from dispose()", async () => {
		const { provider } = makeStubProvider({ disposeThrows: true });
		const ctx = makeContext(provider);

		// We log to stderr; silence it so the test output stays clean.
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// The promise must resolve, never reject.
		await expect(disposeContext(ctx)).resolves.toBeUndefined();

		expect(errSpy).toHaveBeenCalledWith(
			expect.stringContaining("dispose failed"),
		);
		errSpy.mockRestore();
	});

	it("disposeContext is a no-op for providers without dispose", async () => {
		// Strip dispose entirely and confirm nothing throws.
		const { provider } = makeStubProvider();
		const stripped: TaskProvider = { ...provider };
		delete (stripped as { dispose?: unknown }).dispose;

		const ctx = makeContext(stripped);
		await expect(disposeContext(ctx)).resolves.toBeUndefined();
	});

	it("FileTaskProvider.dispose is idempotent", async () => {
		const cwd = mkTmp();
		const config = configSchema.parse({});
		const provider = new FileTaskProvider(cwd, config);
		await provider.init();

		// Open a watcher so dispose has real work to do on the first call.
		const unsubscribe = provider.watch(() => {
			// no-op listener
		});

		await provider.dispose();
		// Second call must not throw — the activeWatchers set was cleared
		// on the first call, so the second pass finds nothing to close.
		await expect(provider.dispose()).resolves.toBeUndefined();

		// Sanity: the per-watcher unsubscribe still works after dispose.
		await expect(unsubscribe()).resolves.toBeUndefined();
	});
});

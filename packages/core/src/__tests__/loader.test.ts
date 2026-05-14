import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configSchema, type OrdnaConfig } from "../config.js";
import { FileTaskProvider } from "../providers/file.js";
import { loadProvider } from "../providers/load.js";

function makeConfig(overrides: Partial<OrdnaConfig> = {}): OrdnaConfig {
	return configSchema.parse({ ...overrides });
}

// Test fixtures live in the workspace-root node_modules so the loader's
// dynamic import resolves them naturally. Writing into the active workspace
// is intentionally scoped to unique fixture names that no real plugin
// could collide with.
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_NODE_MODULES = resolve(__dirname, "../../../../node_modules");
const MALFORMED_DIR = join(
	WORKSPACE_NODE_MODULES,
	"@frehilm",
	"ordna-test-fixture-malformed",
);

describe("loadProvider", () => {
	it("returns a FileTaskProvider for provider: file", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "ordna-loader-"));
		const provider = await loadProvider(makeConfig(), tmp);
		expect(provider).toBeInstanceOf(FileTaskProvider);
		expect(provider.kind).toBe("file");
	});

	it("throws an actionable error when an external provider isn't installed", async () => {
		const tmp = mkdtempSync(join(tmpdir(), "ordna-loader-"));
		// A name no real package will ever claim under the @frehilm scope.
		const cfg = makeConfig({ provider: "definitely-not-installed-zzz-9999" });
		await expect(loadProvider(cfg, tmp)).rejects.toThrow(
			/Provider "definitely-not-installed-zzz-9999" not installed\. Run: pnpm add @frehilm\/ordna-definitely-not-installed-zzz-9999/,
		);
	});

	describe("with a malformed plugin fixture", () => {
		beforeAll(() => {
			mkdirSync(MALFORMED_DIR, { recursive: true });
			writeFileSync(
				join(MALFORMED_DIR, "package.json"),
				JSON.stringify({
					name: "@frehilm/ordna-test-fixture-malformed",
					version: "0.0.0",
					type: "module",
					main: "index.js",
				}),
				"utf8",
			);
			// Deliberately omit `createProvider` to trigger the contract error.
			writeFileSync(
				join(MALFORMED_DIR, "index.js"),
				"export const notTheRightExport = true;\n",
				"utf8",
			);
		});

		afterAll(() => {
			rmSync(MALFORMED_DIR, { recursive: true, force: true });
		});

		it("throws a contract error when createProvider is missing", async () => {
			const tmp = mkdtempSync(join(tmpdir(), "ordna-loader-"));
			const cfg = makeConfig({ provider: "test-fixture-malformed" });
			await expect(loadProvider(cfg, tmp)).rejects.toThrow(
				/does not export a `createProvider\(config, cwd\)` factory/,
			);
		});
	});
});

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, configSchema } from "../config.js";
import { extractIdFromFilename, formatId, nextId, parseId } from "../ids.js";
import { makeTempRepo } from "./helpers.js";

describe("ids", () => {
	it("formats with default zero padding", () => {
		expect(formatId(DEFAULT_CONFIG, 1)).toBe("T-001");
		expect(formatId(DEFAULT_CONFIG, 42)).toBe("T-042");
	});

	it("honors custom prefix and padding", () => {
		const config = configSchema.parse({ idPrefix: "BUG", zeroPaddedIds: 4 });
		expect(formatId(config, 7)).toBe("BUG-0007");
	});

	it("parses ordna and backlog filenames", () => {
		expect(extractIdFromFilename(DEFAULT_CONFIG, "T-001.md")).toBe(1);
		expect(extractIdFromFilename(DEFAULT_CONFIG, "task-42 - some title.md")).toBe(42);
		expect(extractIdFromFilename(DEFAULT_CONFIG, "random.md")).toBeNull();
	});

	it("nextId scans existing files and increments from the max", () => {
		const repo = makeTempRepo("ordna");
		writeFileSync(join(repo.tasksDir, "T-001.md"), "---\nid: T-001\n---\n", "utf8");
		writeFileSync(join(repo.tasksDir, "T-007.md"), "---\nid: T-007\n---\n", "utf8");
		expect(nextId(DEFAULT_CONFIG, repo.tasksDir)).toBe("T-008");
	});

	it("parseId returns null on mismatch", () => {
		expect(parseId(DEFAULT_CONFIG, "task-1")).toBeNull();
		expect(parseId(DEFAULT_CONFIG, "T-5")).toBe(5);
	});
});

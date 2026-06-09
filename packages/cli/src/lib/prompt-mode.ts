import { createInterface } from "node:readline/promises";
import { c } from "../colors.js";

/**
 * Interactive prompt asking the user to pick one of the three storage
 * modes. Used by `ordna init` (no `--storage` flag) and by every
 * one-shot CLI command via `ensureContextOrExit` when detection
 * lands on `ask`.
 *
 * Terse by design: three numbered options, two-line description, an
 * inline 1/2/3 prompt. Trade-off discussion belongs in the README,
 * not the prompt.
 */
export async function promptStorageMode(): Promise<
	"file" | "hybrid" | "namespace"
> {
	console.log("");
	console.log(c.bold("Pick a storage mode for this project."));
	console.log("");
	console.log(
		`  1) ${c.bold("file")}      Tasks as markdown in tasks/  ${c.dim("(default, recommended)")}`,
	);
	console.log(
		`  2) ${c.bold("hybrid")}    Tasks as files + synced ID allocator + audit log in git`,
	);
	console.log(
		`  3) ${c.bold("namespace")} Tasks as git refs; working tree stays clean`,
	);
	console.log("");

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		while (true) {
			const answer = (
				await rl.question(c.dim("Pick a storage mode [1/2/3, default 1]: "))
			)
				.trim()
				.toLowerCase();
			if (answer === "" || answer === "1" || answer === "file") return "file";
			if (answer === "2" || answer === "hybrid") return "hybrid";
			if (answer === "3" || answer === "namespace") return "namespace";
			console.log(c.dim("  Please enter 1, 2, or 3."));
		}
	} finally {
		rl.close();
	}
}

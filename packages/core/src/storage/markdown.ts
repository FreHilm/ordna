/**
 * Markdown primitives used by all storage backends.
 *
 * Thin re-export layer over `parser.ts` and `writer.ts` so future
 * backends (hybrid, namespace) have one import surface for "turn task
 * bytes into a Task" and "turn a Task into bytes." The underlying
 * `parser.ts` / `writer.ts` modules stay where they are for back-compat
 * with anything that imports them directly.
 *
 * The `parseTask` function is also re-exported under the more
 * descriptive name `parseTaskBytes` — at the storage seam, callers are
 * working with raw bytes (from disk, from a git blob) rather than
 * "task files," so the name reflects the boundary.
 */

export {
	parseTask as parseTaskBytes,
	parseTask,
	parseTaskFile,
} from "../parser.js";

export { defaultSectionsFor, serializeTask } from "../writer.js";

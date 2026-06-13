import { useStdin } from "ink";
import { useEffect, useRef, useState } from "react";

export interface TerminalSize {
	rows: number;
	columns: number;
}

/**
 * Subscribes to Ink's raw stdin event emitter so we can disambiguate
 * Backspace from forward-Delete. Ink itself can't: macOS Backspace
 * sends `\x7f` and forward-Delete sends `\x1b[3~`, but both end up as
 * `key.delete === true` in the parsed key object (see Ink's
 * parse-keypress.js `TODO(vadimdemedes)` note about not splitting them
 * to avoid a breaking change).
 *
 * The hook calls `onBackspace` for the byte sequences a real Backspace
 * sends (`\x7f` or `\b`) and `onForwardDelete` for the forward-Delete
 * sequences (`\x1b[3~` and its rxvt/vt220 variants). Callers should
 * skip these keys in their `useInput` handlers so the two paths don't
 * fight.
 *
 * Pass `isActive=false` to detach (e.g. when the field loses focus).
 */
export function useRawBackspaceDelete(
	onBackspace: () => void,
	onForwardDelete: () => void,
	isActive = true,
): void {
	const onBackspaceRef = useRef(onBackspace);
	const onForwardDeleteRef = useRef(onForwardDelete);
	onBackspaceRef.current = onBackspace;
	onForwardDeleteRef.current = onForwardDelete;

	const stdin = useStdin() as unknown as {
		internal_eventEmitter?: {
			on: (event: string, listener: (data: unknown) => void) => void;
			removeListener: (
				event: string,
				listener: (data: unknown) => void,
			) => void;
		};
	};

	useEffect(() => {
		if (!isActive) return;
		const emitter = stdin.internal_eventEmitter;
		if (!emitter) return;
		const handler = (data: unknown): void => {
			const seq =
				typeof data === "string"
					? data
					: Buffer.isBuffer(data)
						? data.toString("utf8")
						: "";
			if (seq.length === 0) return;
			if (seq === "\x7f" || seq === "\b") {
				onBackspaceRef.current();
				return;
			}
			if (seq === "\x1b[3~" || seq === "\x1b[3$" || seq === "\x1b[3^") {
				onForwardDeleteRef.current();
				return;
			}
		};
		emitter.on("input", handler);
		return () => {
			emitter.removeListener("input", handler);
		};
	}, [isActive, stdin]);
}

export function useTerminalSize(): TerminalSize {
	const [size, setSize] = useState<TerminalSize>({
		rows: process.stdout.rows || 24,
		columns: process.stdout.columns || 80,
	});

	useEffect(() => {
		const onResize = (): void => {
			setSize({
				rows: process.stdout.rows || 24,
				columns: process.stdout.columns || 80,
			});
		};
		process.stdout.on("resize", onResize);
		return () => {
			process.stdout.off("resize", onResize);
		};
	}, []);

	return size;
}

import { type Attachment, type StoreContext, type Task, readAttachment } from "@frehilm/ordna-core";
import { Box, Text, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import terminalImage from "terminal-image";
import { formatBytes, isImageViewable, isTextViewable } from "../lib/attachment-utils.js";
import { theme } from "./theme.js";

interface Props {
	ctx: StoreContext;
	task: Task;
	att: Attachment;
	onClose: () => void;
	onOpenExternal: () => void;
	width: number;
	height: number;
}

type ViewState =
	| { kind: "loading" }
	/** ANSI half-block rendering from terminal-image — plain text, works in any truecolor terminal. */
	| { kind: "image"; ansi: string }
	| { kind: "text"; lines: string[] }
	/** Neither image nor text (zip, pdf, …) — only external open makes sense. */
	| { kind: "binary" }
	| { kind: "error"; message: string };

/**
 * In-TUI attachment viewer.
 *
 * Images render via `terminal-image` (Unicode half-blocks + 24-bit
 * color): pure text output, so it composes with Ink's redraw loop and
 * needs no terminal-specific graphics protocol (sixel / iTerm / kitty).
 * Text formats render with the same line-scroll pattern as TaskDetail.
 * Bytes come from `readAttachment`, so this works on every storage
 * backend — including namespace, where there is no file on disk.
 */
export function FileViewer({
	ctx,
	task,
	att,
	onClose,
	onOpenExternal,
	width,
	height,
}: Props): React.JSX.Element {
	const innerWidth = Math.max(10, width - 4);
	// Rows inside the popup: 2 border + 2 paddingY + 1 header + 1 footer + 1 margin above footer.
	const contentHeight = Math.max(3, height - 7);

	const [state, setState] = useState<ViewState>({ kind: "loading" });
	const [scrollOffset, setScrollOffset] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		setScrollOffset(0);
		void (async () => {
			try {
				const { meta, bytes } = await readAttachment(task.id, att.id, ctx);
				if (cancelled) return;
				if (isImageViewable(meta)) {
					const ansi = await terminalImage.buffer(new Uint8Array(bytes), {
						width: innerWidth,
						height: contentHeight,
						preserveAspectRatio: true,
					});
					if (!cancelled) setState({ kind: "image", ansi: ansi.trimEnd() });
				} else if (isTextViewable(meta)) {
					setState({ kind: "text", lines: bytes.toString("utf8").split(/\r?\n/) });
				} else {
					setState({ kind: "binary" });
				}
			} catch (err) {
				if (!cancelled) {
					setState({ kind: "error", message: (err as Error).message });
				}
			}
		})();
		return () => {
			cancelled = true;
		};
		// Re-render on resize too: the image is rasterized to a specific
		// column/row budget, so new dimensions need a fresh pass.
	}, [task.id, att.id, ctx, innerWidth, contentHeight]);

	// --- text scrolling (same shape as TaskDetail's section scroller) ---
	const lines = state.kind === "text" ? state.lines : [];
	const needsScroll = lines.length > contentHeight;
	const visibleCount = needsScroll ? Math.max(1, contentHeight - 2) : contentHeight;
	const maxOffset = Math.max(0, lines.length - visibleCount);
	const offset = Math.max(0, Math.min(maxOffset, scrollOffset));

	useInput((input, key) => {
		if (key.escape || input === "q") {
			onClose();
			return;
		}
		if (input === "o") {
			onOpenExternal();
			return;
		}
		if (state.kind !== "text") return;
		if (key.upArrow || input === "k") {
			setScrollOffset((o) => Math.max(0, o - 1));
		} else if (key.downArrow || input === "j") {
			setScrollOffset((o) => Math.min(maxOffset, o + 1));
		} else if (key.pageUp) {
			setScrollOffset((o) => Math.max(0, o - visibleCount));
		} else if (key.pageDown) {
			setScrollOffset((o) => Math.min(maxOffset, o + visibleCount));
		}
	});

	const renderContent = (): React.JSX.Element => {
		if (state.kind === "loading") {
			return <Text color={theme.textMuted}>Loading…</Text>;
		}
		if (state.kind === "error") {
			return <Text color={theme.textMuted}>{state.message}</Text>;
		}
		if (state.kind === "binary") {
			return (
				<Text color={theme.textMuted}>
					No inline preview for this file type. Press <Text bold>o</Text> to open it with the system
					viewer.
				</Text>
			);
		}
		if (state.kind === "image") {
			return <Text>{state.ansi}</Text>;
		}
		const visible = lines.slice(offset, offset + visibleCount);
		return (
			<Box flexDirection="column">
				{needsScroll ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						{offset > 0 ? `↑ ${offset} more` : " "}
					</Text>
				) : null}
				{visible.map((line, idx) => (
					<Text
						// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional; offset+idx is the stable identity
						key={offset + idx}
						color={theme.text}
						wrap="truncate-end"
					>
						{line.length > 0 ? line : " "}
					</Text>
				))}
				{needsScroll ? (
					<Text color={theme.textMuted} italic wrap="truncate-end">
						{offset + visibleCount < lines.length
							? `↓ ${lines.length - offset - visibleCount} more`
							: " "}
					</Text>
				) : null}
			</Box>
		);
	};

	const hints: string[] = [];
	if (state.kind === "text" && needsScroll) hints.push("↑/↓ scroll");
	hints.push("o open externally", "Esc / q close");

	return (
		<Box
			flexDirection="column"
			borderStyle="double"
			borderColor={theme.borderFocused}
			width={width}
			height={height}
			paddingX={2}
			paddingY={1}
			overflowY="hidden"
		>
			<Box>
				<Text color={theme.accent} bold>
					{att.name}
				</Text>
				<Text color={theme.textMuted}>
					{`  ${formatBytes(att.size)}${att.type ? ` · ${att.type}` : ""} · ${task.id}`}
				</Text>
			</Box>

			<Box flexDirection="column" width={innerWidth} height={contentHeight} overflowY="hidden">
				{renderContent()}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.textMuted} italic>
					{hints.join(" · ")}
				</Text>
			</Box>
		</Box>
	);
}

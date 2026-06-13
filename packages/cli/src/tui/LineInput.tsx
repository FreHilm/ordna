import { Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import { useRawBackspaceDelete } from "./hooks.js";
import { theme } from "./theme.js";

interface Props {
	value: string;
	onChange: (next: string) => void;
	onSubmit?: (value: string) => void;
	placeholder?: string;
	focus?: boolean;
}

function isWordChar(ch: string): boolean {
	return /[A-Za-z0-9_]/.test(ch);
}

function wordLeft(value: string, cursor: number): number {
	let i = cursor;
	while (i > 0 && !isWordChar(value[i - 1] ?? "")) i -= 1;
	while (i > 0 && isWordChar(value[i - 1] ?? "")) i -= 1;
	return i;
}

function wordRight(value: string, cursor: number): number {
	let i = cursor;
	const n = value.length;
	while (i < n && !isWordChar(value[i] ?? "")) i += 1;
	while (i < n && isWordChar(value[i] ?? "")) i += 1;
	return i;
}

/**
 * Single-line text input with **correct** backspace / delete semantics.
 *
 * Ink's `key.backspace` / `key.delete` are inverted on macOS and most
 * modern terminals — both Backspace (`\x7f`) and the forward-delete
 * escape sequence (`\x1b[3~`) end up as `key.delete = true`,
 * indistinguishable in the parsed key object. We disambiguate by
 * tapping the raw stdin byte stream via `useRawBackspaceDelete` and
 * deliberately ignoring `key.backspace` / `key.delete` inside the
 * regular `useInput` handler.
 *
 * Also supports the same shortcuts as the multiline section editor:
 *   - Ctrl+←/→  jump by word
 *   - Ctrl+A / Ctrl+E  jump to line start / end
 */
export function LineInput({
	value,
	onChange,
	onSubmit,
	placeholder,
	focus = true,
}: Props): React.JSX.Element {
	const [cursor, setCursor] = useState(value.length);

	// Clamp cursor when value changes externally (parent reset, etc).
	useEffect(() => {
		setCursor((c) => Math.max(0, Math.min(value.length, c)));
	}, [value]);

	useRawBackspaceDelete(
		() => {
			if (cursor === 0) return;
			onChange(value.slice(0, cursor - 1) + value.slice(cursor));
			setCursor(cursor - 1);
		},
		() => {
			if (cursor >= value.length) return;
			onChange(value.slice(0, cursor) + value.slice(cursor + 1));
		},
		focus,
	);

	useInput(
		(input, key) => {
			// Pass-through: outer container owns these.
			if (key.tab || key.upArrow || key.downArrow) return;
			// Backspace / forward-delete are handled by the raw-byte
			// hook above. See note in `useRawBackspaceDelete`.
			if (key.backspace || key.delete) return;

			if (key.return) {
				onSubmit?.(value);
				return;
			}

			if (key.ctrl && key.leftArrow) {
				setCursor((c) => wordLeft(value, c));
				return;
			}
			if (key.ctrl && key.rightArrow) {
				setCursor((c) => wordRight(value, c));
				return;
			}
			if (key.ctrl && (input === "a" || input === "A")) {
				setCursor(0);
				return;
			}
			if (key.ctrl && (input === "e" || input === "E")) {
				setCursor(value.length);
				return;
			}

			if (key.leftArrow) {
				setCursor((c) => Math.max(0, c - 1));
				return;
			}
			if (key.rightArrow) {
				setCursor((c) => Math.min(value.length, c + 1));
				return;
			}

			// Ctrl/meta + non-shortcut combos: ignore so they don't
			// accidentally insert literal characters.
			if (key.ctrl || key.meta) return;

			if (input) {
				onChange(value.slice(0, cursor) + input + value.slice(cursor));
				setCursor((c) => c + input.length);
			}
		},
		{ isActive: focus },
	);

	// Empty + placeholder: show first char of placeholder under the cursor.
	if (value.length === 0) {
		if (placeholder && placeholder.length > 0) {
			return (
				<Text>
					<Text inverse>{placeholder[0]}</Text>
					<Text color={theme.textFaint}>{placeholder.slice(1)}</Text>
				</Text>
			);
		}
		return <Text inverse>{" "}</Text>;
	}

	const before = value.slice(0, cursor);
	const at = value[cursor];
	const after = value.slice(cursor + 1);
	return (
		<Text>
			{before}
			<Text inverse>{at ?? " "}</Text>
			{after}
		</Text>
	);
}

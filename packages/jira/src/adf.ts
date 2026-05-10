import type { JiraAdfMark, JiraAdfNode } from "./schema.js";

/**
 * Convert an Atlassian Document Format tree to a CommonMark-flavoured
 * markdown string.
 *
 * Scope: the node types Jira actually emits in `description` and comment
 * fields — paragraphs, headings, lists (bullet / ordered), blockquotes,
 * code blocks and inline code, links, mentions, hard breaks, and the
 * inline marks `strong`, `em`, `code`, `strike`, `link`. Unknown nodes
 * fall through to their text content so we never lose information silently.
 *
 * Not a full ADF renderer. The remaining 5% of nodes (tables, panels,
 * media, expand) come through as readable plain text; round-tripping
 * markdown back into ADF for the eventual write milestone will need
 * tighter coverage there.
 */
export function adfToMarkdown(node: JiraAdfNode | null | undefined): string {
	if (!node) return "";
	const out = renderBlock(node, 0).trim();
	// Collapse 3+ consecutive blank lines into 2 (single empty line between
	// paragraphs is canonical markdown).
	return out.replace(/\n{3,}/g, "\n\n");
}

function renderBlock(node: JiraAdfNode, depth: number): string {
	switch (node.type) {
		case "doc":
			return renderChildren(node, depth).join("\n\n");
		case "paragraph":
			return renderInline(node);
		case "heading": {
			const level = clamp(Number(node.attrs?.level ?? 1), 1, 6);
			return `${"#".repeat(level)} ${renderInline(node)}`;
		}
		case "bulletList":
			return renderList(node, depth, () => "- ");
		case "orderedList": {
			let i = Number(node.attrs?.order ?? 1);
			return renderList(node, depth, () => `${i++}. `);
		}
		case "listItem": {
			// listItem children may be paragraphs and/or nested lists.
			// Each paragraph becomes a line; nested lists indent.
			return renderChildren(node, depth).join("\n");
		}
		case "codeBlock": {
			const lang = String(node.attrs?.language ?? "");
			const body = (node.content ?? [])
				.map((n) => n.text ?? "")
				.join("");
			return `\`\`\`${lang}\n${body}\n\`\`\``;
		}
		case "blockquote": {
			const inner = renderChildren(node, depth).join("\n\n");
			return inner
				.split("\n")
				.map((line) => (line.length === 0 ? ">" : `> ${line}`))
				.join("\n");
		}
		case "rule":
			return "---";
		case "hardBreak":
			return "  \n";
		// Inline-level nodes that occasionally appear at block scope.
		case "text":
		case "mention":
		case "emoji":
		case "inlineCard":
		case "blockCard":
			return renderInline({ type: "paragraph", content: [node] });
		default:
			// Unknown block: emit its inline content if any.
			return renderChildren(node, depth).join("\n\n");
	}
}

function renderList(
	node: JiraAdfNode,
	depth: number,
	marker: () => string,
): string {
	const items = (node.content ?? []).map((item) => {
		const itemText = renderBlock(item, depth + 1);
		const lines = itemText.split("\n");
		const first = lines[0] ?? "";
		const rest = lines.slice(1);
		const indent = "  ".repeat(depth);
		const childIndent = `${indent}  `;
		return [
			`${indent}${marker()}${first}`,
			...rest.map((l) => (l.length > 0 ? `${childIndent}${l}` : l)),
		].join("\n");
	});
	return items.join("\n");
}

function renderInline(node: JiraAdfNode): string {
	const parts: string[] = [];
	for (const child of node.content ?? []) {
		parts.push(renderInlineNode(child));
	}
	return parts.join("");
}

function renderInlineNode(node: JiraAdfNode): string {
	switch (node.type) {
		case "text": {
			let text = node.text ?? "";
			// Apply marks in a stable order so nesting is predictable.
			const marks = node.marks ?? [];
			text = applyMarks(text, marks);
			return text;
		}
		case "hardBreak":
			return "  \n";
		case "mention": {
			const display = (node.attrs?.text as string | undefined) ??
				(node.attrs?.displayName as string | undefined) ??
				(node.attrs?.id as string | undefined);
			return display ? `@${stripLeadingAt(display)}` : "";
		}
		case "emoji": {
			const shortName = node.attrs?.shortName as string | undefined;
			const text = node.attrs?.text as string | undefined;
			return text ?? (shortName ? `:${shortName}:` : "");
		}
		case "inlineCard":
		case "blockCard": {
			const url = node.attrs?.url as string | undefined;
			return url ? url : "";
		}
		default:
			// Unknown inline: try to extract text recursively.
			return renderInline(node);
	}
}

function applyMarks(text: string, marks: JiraAdfMark[]): string {
	if (text.length === 0 || marks.length === 0) return text;
	// Process inner-to-outer with a deterministic order: code is the
	// innermost (cannot contain other marks), then strong/em/strike, then
	// link wraps everything. Matches how prosemirror-markdown serialises.
	let result = text;
	const has = (type: string): boolean => marks.some((m) => m.type === type);

	if (has("code")) return `\`${result}\``;
	if (has("strike")) result = `~~${result}~~`;
	if (has("em")) result = `*${result}*`;
	if (has("strong")) result = `**${result}**`;
	const link = marks.find((m) => m.type === "link");
	if (link) {
		const href = link.attrs?.href as string | undefined;
		if (href) result = `[${result}](${href})`;
	}
	return result;
}

function renderChildren(node: JiraAdfNode, depth: number): string[] {
	return (node.content ?? []).map((c) => renderBlock(c, depth));
}

function clamp(n: number, min: number, max: number): number {
	if (!Number.isFinite(n)) return min;
	return Math.max(min, Math.min(max, Math.floor(n)));
}

function stripLeadingAt(s: string): string {
	return s.startsWith("@") ? s.slice(1) : s;
}

import { describe, expect, it } from "vitest";
import { adfToMarkdown } from "../adf.js";
import type { JiraAdfNode } from "../schema.js";

function doc(...content: JiraAdfNode[]): JiraAdfNode {
	return { type: "doc", content };
}
function p(...content: JiraAdfNode[]): JiraAdfNode {
	return { type: "paragraph", content };
}
function t(text: string, marks: { type: string; attrs?: object }[] = []): JiraAdfNode {
	return { type: "text", text, marks };
}

describe("adfToMarkdown", () => {
	it("returns empty string for null / empty input", () => {
		expect(adfToMarkdown(null)).toBe("");
		expect(adfToMarkdown(undefined)).toBe("");
		expect(adfToMarkdown(doc())).toBe("");
	});

	it("renders plain paragraphs separated by blank lines", () => {
		const out = adfToMarkdown(doc(p(t("Hello")), p(t("World"))));
		expect(out).toBe("Hello\n\nWorld");
	});

	it("renders headings", () => {
		const heading = (level: number) => ({
			type: "heading",
			attrs: { level },
			content: [t("Title")],
		});
		expect(adfToMarkdown(doc(heading(1)))).toBe("# Title");
		expect(adfToMarkdown(doc(heading(3)))).toBe("### Title");
	});

	it("renders inline marks (strong, em, code, strike, link)", () => {
		const out = adfToMarkdown(
			doc(
				p(
					t("bold", [{ type: "strong" }]),
					t(" "),
					t("italic", [{ type: "em" }]),
					t(" "),
					t("code", [{ type: "code" }]),
					t(" "),
					t("gone", [{ type: "strike" }]),
					t(" "),
					t("link", [{ type: "link", attrs: { href: "https://example.com" } }]),
				),
			),
		);
		expect(out).toBe("**bold** *italic* `code` ~~gone~~ [link](https://example.com)");
	});

	it("renders bullet lists with nested paragraphs", () => {
		const out = adfToMarkdown(
			doc({
				type: "bulletList",
				content: [
					{ type: "listItem", content: [p(t("first"))] },
					{ type: "listItem", content: [p(t("second"))] },
				],
			}),
		);
		expect(out).toBe("- first\n- second");
	});

	it("renders ordered lists with the configured start index", () => {
		const out = adfToMarkdown(
			doc({
				type: "orderedList",
				attrs: { order: 3 },
				content: [
					{ type: "listItem", content: [p(t("third"))] },
					{ type: "listItem", content: [p(t("fourth"))] },
				],
			}),
		);
		expect(out).toBe("3. third\n4. fourth");
	});

	it("renders code blocks with language", () => {
		const out = adfToMarkdown(
			doc({
				type: "codeBlock",
				attrs: { language: "ts" },
				content: [{ type: "text", text: "const x = 1;" }],
			}),
		);
		expect(out).toBe("```ts\nconst x = 1;\n```");
	});

	it("renders mentions as @name", () => {
		const out = adfToMarkdown(
			doc(p(t("Hi "), { type: "mention", attrs: { text: "@alice" } })),
		);
		expect(out).toBe("Hi @alice");
	});

	it("renders blockquotes", () => {
		const out = adfToMarkdown(
			doc({ type: "blockquote", content: [p(t("quoted")), p(t("two"))] }),
		);
		expect(out).toBe("> quoted\n>\n> two");
	});

	it("renders horizontal rule", () => {
		const out = adfToMarkdown(doc(p(t("a")), { type: "rule" }, p(t("b"))));
		expect(out).toBe("a\n\n---\n\nb");
	});

	it("falls through unknown node types to inner text", () => {
		const out = adfToMarkdown(
			doc({
				type: "panel",
				attrs: { panelType: "info" },
				content: [p(t("note"))],
			}),
		);
		expect(out).toBe("note");
	});
});

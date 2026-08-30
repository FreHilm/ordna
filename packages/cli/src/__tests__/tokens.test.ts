import { describe, expect, it } from "vitest";
import { stringToTokens, tokensToString } from "../tui/tokens.js";

describe("TUI tag/depends_on token parsing", () => {
	it("splits on comma, semicolon, and space", () => {
		expect(stringToTokens("a,b;c d")).toEqual(["a", "b", "c", "d"]);
	});

	it("separator runs like ', ' or ' ;' never double-create tokens", () => {
		expect(stringToTokens("a, b ;  c ,; d")).toEqual(["a", "b", "c", "d"]);
	});

	it("ignores leading/trailing separators and empty input", () => {
		expect(stringToTokens(" ,a, ")).toEqual(["a"]);
		expect(stringToTokens("")).toEqual([]);
		expect(stringToTokens(" ,; ")).toEqual([]);
	});

	it("dedupes repeated tokens, keeping first-occurrence order", () => {
		expect(stringToTokens("web, ui, web")).toEqual(["web", "ui"]);
	});

	it("round-trips to the uniform 'a, b, c' display format", () => {
		expect(tokensToString(stringToTokens("a  b,,c;"))).toBe("a, b, c");
	});
});

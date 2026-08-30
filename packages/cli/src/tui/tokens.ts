/**
 * Token-list helpers for the TUI's tags / depends_on editors.
 *
 * `stringToTokens` accepts comma, semicolon, and whitespace as
 * separators (matching the web TagInput), collapses separator runs so
 * ", " or " ;" never double-creates, and dedupes repeated tokens while
 * keeping first-occurrence order. `tokensToString` is the uniform
 * display format: `tag1, tag2, tag3`.
 */

export function tokensToString(tokens: string[]): string {
	return tokens.join(", ");
}

export function stringToTokens(value: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of value.split(/[,;\s]+/)) {
		const token = raw.trim();
		if (token.length === 0 || seen.has(token)) continue;
		seen.add(token);
		out.push(token);
	}
	return out;
}

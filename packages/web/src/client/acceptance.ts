export interface AcceptanceItem {
	id: string;
	text: string;
	checked: boolean;
}

const CHECKBOX_RE = /^\s*-\s+\[( |x|X)\]\s+(.*)$/;

let nextId = 0;
function newId(): string {
	nextId += 1;
	return `ac-${Date.now()}-${nextId}`;
}

export function parseAcceptance(content: string): AcceptanceItem[] {
	if (!content) return [];
	const items: AcceptanceItem[] = [];
	for (const line of content.split("\n")) {
		const m = line.match(CHECKBOX_RE);
		if (!m) continue;
		items.push({
			id: newId(),
			checked: m[1] !== " ",
			text: (m[2] ?? "").trim(),
		});
	}
	return items;
}

export function serializeAcceptance(items: AcceptanceItem[]): string {
	if (items.length === 0) return "";
	return items
		.map((i) => `- [${i.checked ? "x" : " "}] ${i.text}`)
		.join("\n");
}

export function makeItem(text = ""): AcceptanceItem {
	return { id: newId(), text, checked: false };
}

export const ACCEPTANCE_HEADING_RE = /^acceptance criteria$/i;

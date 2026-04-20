import type { OrdnaConfig, WireTask } from "../shared/types.js";

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const text = await res.text();
		let message = text;
		try {
			const parsed = JSON.parse(text) as { error?: string; message?: string };
			message = parsed.error ?? parsed.message ?? text;
		} catch {
			// not JSON — use raw text
		}
		throw new Error(message || `${res.status} ${res.statusText}`);
	}
	return (await res.json()) as T;
}

export const api = {
	config: (): Promise<OrdnaConfig> => fetch("/api/config").then((r) => json<OrdnaConfig>(r)),
	list: (): Promise<WireTask[]> => fetch("/api/tasks").then((r) => json<WireTask[]>(r)),
	create: (input: { title: string }): Promise<WireTask> =>
		fetch("/api/tasks", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}).then((r) => json<WireTask>(r)),
	move: (id: string, status: string): Promise<WireTask> =>
		fetch(`/api/tasks/${encodeURIComponent(id)}/move`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status }),
		}).then((r) => json<WireTask>(r)),
	update: (id: string, patch: Partial<WireTask>): Promise<WireTask> =>
		fetch(`/api/tasks/${encodeURIComponent(id)}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(patch),
		}).then((r) => json<WireTask>(r)),
	remove: (id: string): Promise<void> =>
		fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => {
			if (!r.ok) throw new Error(r.statusText);
		}),
};

import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import {
	createContext as createStoreContext,
	ensureStorageConfig,
	NeedsModeSelection,
	type StoreContext,
	watchTasks,
	writeStorageConfig,
} from "@frehilm/ordna-core";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { type AgentHookConfig, loadAgentHook } from "./agent.js";
import { type ApiState, buildApiRoutes } from "./routes.js";
import { toWireTask, type WsEvent } from "../shared/types.js";

export interface RunWebOptions {
	cwd?: string;
	port?: number;
	host?: string;
	openBrowser?: boolean;
	clientDir?: string;
	/**
	 * Programmatic agent hook config. Overrides ORDNA_AGENT_HOOK_* env vars.
	 * Pass `null` to disable the hook explicitly even if env vars are set.
	 */
	agentHook?: AgentHookConfig | null;
}

export interface RunWebHandle {
	port: number;
	close: () => Promise<void>;
	/**
	 * The active `StoreContext` once a storage mode has been chosen. `null`
	 * while the server is in setup mode (no `.ordna/config.yaml` and
	 * detection landed on "ask"). Flips to a real context in-place after
	 * the user POSTs a mode to `/api/setup-mode` — no restart required.
	 */
	context: StoreContext | null;
	/** True when the server is in setup mode (see `context` above). */
	needsSetup: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

type Client = { send: (data: string) => void };

interface ServerState extends ApiState {
	cwd: string;
	unsubscribe: (() => Promise<void>) | null;
	reason: string;
	clients: Set<Client>;
	broadcast: (event: WsEvent) => void;
}

function resolveClientDir(clientDir?: string): string | null {
	const candidates = [
		clientDir,
		resolve(__dirname, "../../dist-client"),
		resolve(__dirname, "../../../dist-client"),
	].filter((p): p is string => typeof p === "string");
	for (const dir of candidates) {
		if (existsSync(join(dir, "index.html"))) return dir;
	}
	return null;
}

function wireWatcher(state: ServerState): void {
	if (!state.ctx || state.unsubscribe) return;
	state.unsubscribe = watchTasks(state.ctx, (event) => {
		if (event.type === "removed") {
			const id =
				event.filePath.split("/").pop()?.replace(/\.md$/, "") ??
				event.filePath;
			state.broadcast({ type: "removed", id });
		} else if (event.type === "renamed") {
			state.broadcast({
				type: "renamed",
				oldId: event.oldId,
				newId: event.newId,
				task: toWireTask(event.task),
			});
		} else {
			state.broadcast({ type: event.type, task: toWireTask(event.task) });
		}
	});
}

export async function runWeb(options: RunWebOptions = {}): Promise<RunWebHandle> {
	const cwd = options.cwd ?? process.cwd();
	const host = options.host ?? "127.0.0.1";

	// Bootstrap context if config exists or detection lands on a confident
	// mode. If detection lands on "ask", we still listen — the gate
	// middleware serves the setup page until the user POSTs a mode.
	let initialCtx: StoreContext | null = null;
	let reason = "";
	try {
		await ensureStorageConfig(cwd);
		initialCtx = createStoreContext(cwd);
	} catch (err) {
		if (err instanceof NeedsModeSelection) {
			reason = err.reason;
		} else {
			throw err;
		}
	}

	const port = options.port ?? initialCtx?.config.webPort ?? 7420;
	const agentHook =
		options.agentHook === null ? null : (options.agentHook ?? loadAgentHook());

	const clients = new Set<Client>();
	const broadcast = (event: WsEvent): void => {
		const data = JSON.stringify(event);
		for (const client of clients) {
			try {
				client.send(data);
			} catch {
				// Drop broken clients silently; node-ws handles lifecycle via close events.
			}
		}
	};

	const state: ServerState = {
		cwd,
		ctx: initialCtx,
		agentHook,
		unsubscribe: null,
		reason,
		clients,
		broadcast,
	};

	if (state.ctx) wireWatcher(state);

	const app = new Hono();
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

	// Setup gate: when no ctx, short-circuit every request with the setup
	// page (except the POST that writes the config). Once state.ctx flips
	// to a real context, this gate falls through and the regular API /
	// websocket / static routes take over.
	app.use("*", async (c, next) => {
		if (state.ctx !== null) return next();
		const path = c.req.path;
		if (c.req.method === "POST" && path === "/api/setup-mode") return next();
		if (path === "/favicon.ico") return c.notFound();
		return c.html(setupPage(state.reason));
	});

	app.post("/api/setup-mode", async (c) => {
		if (state.ctx !== null) {
			return c.text("Already configured.", 400);
		}
		const body = await c.req.parseBody();
		const storage = body.storage;
		if (
			storage !== "file" &&
			storage !== "hybrid" &&
			storage !== "namespace"
		) {
			return c.text("Invalid storage mode", 400);
		}
		writeStorageConfig(state.cwd, storage);
		state.ctx = createStoreContext(state.cwd);
		wireWatcher(state);
		return c.html(savedPage(storage));
	});

	app.route("/api", buildApiRoutes(state));

	app.get(
		"/ws",
		upgradeWebSocket(() => ({
			onOpen(_evt, ws) {
				const client: Client = { send: (data) => ws.send(data) };
				clients.add(client);
				(ws as unknown as { _ordnaClient?: Client })._ordnaClient = client;
			},
			onClose(_evt, ws) {
				const client = (ws as unknown as { _ordnaClient?: Client })
					._ordnaClient;
				if (client) clients.delete(client);
			},
		})),
	);

	const clientDir = resolveClientDir(options.clientDir);
	if (clientDir) {
		app.use(
			"/*",
			serveStatic({
				root: clientDir,
				rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
			}),
		);
		app.get("*", async (c) => {
			const indexPath = join(clientDir, "index.html");
			const fs = await import("node:fs/promises");
			const html = await fs.readFile(indexPath, "utf8");
			return c.html(html);
		});
	} else {
		app.get("/", (c) =>
			c.text(
				"Ordna server is running. Client bundle missing — run `pnpm --filter @frehilm/ordna-web build:client`.",
			),
		);
	}

	const server = serve({ fetch: app.fetch, port, hostname: host });
	injectWebSocket(server);

	await new Promise<void>((resolve) => {
		if (server.listening) resolve();
		else server.once("listening", () => resolve());
	});
	const address = server.address();
	const actualPort =
		typeof address === "object" && address !== null ? address.port : port;

	if (options.openBrowser) {
		const url = `http://${host}:${actualPort}`;
		const { spawn } = await import("node:child_process");
		try {
			let child: ReturnType<typeof spawn>;
			if (process.platform === "win32") {
				// `start` is a cmd.exe builtin, not a PATH binary, so
				// `spawn("start", ...)` fails with ENOENT. Invoke it
				// through cmd. The empty "" is `start`'s window-title
				// argument; without it, the URL is consumed as the
				// title and no browser opens.
				child = spawn("cmd", ["/c", "start", "", url], {
					stdio: "ignore",
					detached: true,
					windowsHide: true,
				});
			} else {
				const opener =
					process.platform === "darwin" ? "open" : "xdg-open";
				child = spawn(opener, [url], {
					stdio: "ignore",
					detached: true,
				});
			}
			// ENOENT and other spawn failures fire async as `error`
			// events on the child process, not as thrown exceptions —
			// without this listener Node's default action is to crash
			// the parent process. Best-effort: swallow.
			child.on("error", () => {
				// e.g. xdg-open not installed; user can open the URL manually.
			});
			child.unref();
		} catch {
			// Belt-and-suspenders for the rare case where spawn throws
			// synchronously (extremely uncommon).
		}
	}

	const close = async (): Promise<void> => {
		if (state.unsubscribe) await state.unsubscribe();
		const s = server as unknown as {
			closeAllConnections?: () => void;
			closeIdleConnections?: () => void;
			close: (cb: () => void) => void;
		};
		s.closeIdleConnections?.();
		s.closeAllConnections?.();
		await new Promise<void>((r) => s.close(() => r()));
	};

	return {
		port: actualPort,
		close,
		get context() {
			return state.ctx;
		},
		get needsSetup() {
			return state.ctx === null;
		},
	};
}

function setupPage(reason: string): string {
	// The internal detection reason is developer-speak ("no storage
	// signals found, but this is a git repo") — translate the known case
	// into a welcome, and keep whatever it was as a small footnote.
	const isFreshRepo = reason.includes("no storage signals");
	const lede = isFreshRepo
		? "This project isn\u2019t using Ordna yet \u2014 let\u2019s set it up. Pick where your tasks should live; you can change this later in <code>.ordna/config.yaml</code>."
		: escapeHtml(reason);
	const footnote = isFreshRepo
		? "Detected: a git repository with no existing Ordna tasks."
		: "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Welcome to Ordna</title>
<style>
  :root {
    --bg: #f6f2ea; --card: #fffdf9; --line: #ddd5c6; --line-strong: #bfb49d;
    --text: #1c1b18; --text-2: #504e47; --text-3: #807d73;
    --accent: #d97706; --accent-2: #b45309; --accent-soft: rgba(217, 119, 6, 0.08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #141416; --card: #1c1c1f; --line: #2d2d33; --line-strong: #3a3a42;
      --text: #ececee; --text-2: #a8a8b0; --text-3: #76767f;
      --accent: #f59e0b; --accent-2: #fbbf24; --accent-soft: rgba(245, 158, 11, 0.1);
    }
  }
  * { box-sizing: border-box; }
  body { font-family: "Geist", "Inter", -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); max-width: 620px; margin: 9vh auto 4rem; padding: 0 1.5rem; line-height: 1.55; }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 1.75rem; }
  .brand-logo { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); display: inline-flex; align-items: center; justify-content: center; color: #141416; font-weight: 700; font-size: 18px; }
  .brand-name { font-size: 20px; font-weight: 650; letter-spacing: -0.02em; }
  h1 { font-size: 1.45rem; letter-spacing: -0.015em; margin: 0 0 0.4rem; }
  p.lede { color: var(--text-2); margin: 0 0 1.6rem; }
  p.lede code { background: var(--accent-soft); border-radius: 4px; padding: 1px 6px; font-size: 0.85em; }
  .options { display: flex; flex-direction: column; gap: 10px; margin: 0 0 1.4rem; }
  label.option { display: flex; gap: 12px; align-items: flex-start; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; cursor: pointer; transition: border-color 0.12s, background 0.12s; }
  label.option:hover { border-color: var(--line-strong); }
  label.option:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
  label.option input { margin-top: 4px; accent-color: var(--accent); }
  .option-title { font-weight: 600; }
  .option-title .tag { font-size: 11px; font-weight: 600; color: var(--accent); border: 1px solid var(--accent); border-radius: 999px; padding: 1px 8px; margin-left: 8px; vertical-align: 1px; }
  .option-desc { display: block; color: var(--text-2); font-size: 0.9rem; margin-top: 2px; }
  button { background: var(--accent); color: #141416; border: 0; padding: 0.65rem 1.4rem; border-radius: 10px; cursor: pointer; font-size: 1rem; font-weight: 600; font-family: inherit; }
  button:hover { background: var(--accent-2); }
  p.footnote { color: var(--text-3); font-size: 0.8rem; margin-top: 1.6rem; }
</style>
</head>
<body>
<div class="brand"><span class="brand-logo">O</span><span class="brand-name">Ordna</span></div>
<h1>Welcome!</h1>
<p class="lede">${lede}</p>
<form method="post" action="/api/setup-mode">
  <div class="options">
    <label class="option">
      <input type="radio" name="storage" value="file" checked />
      <span>
        <span class="option-title">Task files in your repo<span class="tag">Recommended</span></span>
        <span class="option-desc">Tasks are plain markdown files in <code>tasks/</code> \u2014 readable, diffable, committed with your code. The simplest way to start.</span>
      </span>
    </label>
    <label class="option">
      <input type="radio" name="storage" value="hybrid" />
      <span>
        <span class="option-title">Task files + shared id counter</span>
        <span class="option-desc">Same markdown files, plus a task-number counter synced through git \u2014 pick this when several machines or teammates create tasks in the same project.</span>
      </span>
    </label>
    <label class="option">
      <input type="radio" name="storage" value="namespace" />
      <span>
        <span class="option-title">Invisible (stored inside git)</span>
        <span class="option-desc">Tasks live in git\u2019s own storage \u2014 no files in your working tree, no task commits in your history, syncs automatically. Best when the board shouldn\u2019t touch the repo\u2019s contents.</span>
      </span>
    </label>
  </div>
  <button type="submit">Start using Ordna</button>
</form>
${footnote ? `<p class="footnote">${footnote}</p>` : ""}
</body>
</html>`;
}

function savedPage(mode: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ordna ready</title>
<meta http-equiv="refresh" content="1; url=/" />
<style>
  :root { --bg: #f6f2ea; --card: #fffdf9; --line: #ddd5c6; --text: #1c1b18; --text-2: #504e47; --accent: #d97706; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #141416; --card: #1c1c1f; --line: #2d2d33; --text: #ececee; --text-2: #a8a8b0; --accent: #f59e0b; }
  }
  body { font-family: "Geist", "Inter", -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); max-width: 620px; margin: 12vh auto; padding: 0 1.5rem; line-height: 1.55; }
  .done { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--accent); padding: 1rem 1.25rem; border-radius: 12px; }
  .done p { margin: 0.25rem 0; color: var(--text-2); }
  .done p strong { color: var(--text); }
  a { color: var(--accent); }
  code { background: rgba(128,128,128,0.12); border-radius: 4px; padding: 1px 6px; font-size: 0.9em; }
</style>
</head>
<body>
<div class="done">
  <p><strong>All set \u2014 Storage mode set to <code>${escapeHtml(mode)}</code>.</strong></p>
  <p>Loading your board\u2026 <a href="/">click here</a> if you\u2019re not redirected.</p>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

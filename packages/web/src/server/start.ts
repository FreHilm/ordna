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
import { buildApiRoutes } from "./routes.js";
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
	 * The active `StoreContext` once a storage mode has been chosen.
	 * `null` indicates the server is running in setup mode (no
	 * `.ordna/config.yaml` and detection landed on "ask") — every HTTP
	 * request currently returns the setup page until the user POSTs a
	 * chosen mode, at which point they're asked to restart.
	 */
	context: StoreContext | null;
	/** True when the server is in setup mode (see `context` above). */
	needsSetup: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

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

export async function runWeb(options: RunWebOptions = {}): Promise<RunWebHandle> {
	const cwd = options.cwd ?? process.cwd();

	// Auto-detect storage mode before constructing the context. If
	// detection lands on `ask`, switch into setup mode — the server
	// still listens, but every request returns the setup page until
	// the user POSTs a chosen mode.
	try {
		await ensureStorageConfig(cwd);
	} catch (err) {
		if (err instanceof NeedsModeSelection) {
			return runSetupServer({ cwd, options, reason: err.reason });
		}
		throw err;
	}

	const ctx = createStoreContext(cwd);
	const port = options.port ?? ctx.config.webPort;
	const host = options.host ?? "127.0.0.1";

	const app = new Hono();
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

	const agentHook =
		options.agentHook === null
			? null
			: options.agentHook ?? loadAgentHook();
	app.route("/api", buildApiRoutes(ctx, agentHook));

	type Client = { send: (data: string) => void };
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

	const unsubscribe = watchTasks(ctx, (event) => {
		if (event.type === "removed") {
			const id = event.filePath.split("/").pop()?.replace(/\.md$/, "") ?? event.filePath;
			broadcast({ type: "removed", id });
		} else {
			broadcast({ type: event.type, task: toWireTask(event.task) });
		}
	});

	app.get(
		"/ws",
		upgradeWebSocket(() => ({
			onOpen(_evt, ws) {
				const client: Client = { send: (data) => ws.send(data) };
				clients.add(client);
				(ws as unknown as { _ordnaClient?: Client })._ordnaClient = client;
			},
			onClose(_evt, ws) {
				const client = (ws as unknown as { _ordnaClient?: Client })._ordnaClient;
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
		await unsubscribe();
		const s = server as unknown as {
			closeAllConnections?: () => void;
			closeIdleConnections?: () => void;
			close: (cb: () => void) => void;
		};
		s.closeIdleConnections?.();
		s.closeAllConnections?.();
		await new Promise<void>((r) => s.close(() => r()));
	};

	return { port: actualPort, close, context: ctx, needsSetup: false };
}

/**
 * Run a minimal HTTP server that serves a setup page and accepts a
 * single POST to write the chosen storage mode. Used by `runWeb`
 * when storage detection lands on "ask."
 *
 * After the user POSTs a mode, the config is written but the server
 * does NOT auto-transition to normal mode — the user is asked to
 * restart `ordna web`. In-place transition (re-binding the API
 * routes with a freshly-constructed context) is more complex than
 * the v1 value warrants; restart is one Ctrl-C + re-run.
 */
async function runSetupServer(args: {
	cwd: string;
	options: RunWebOptions;
	reason: string;
}): Promise<RunWebHandle> {
	const port = args.options.port ?? 7420;
	const host = args.options.host ?? "127.0.0.1";

	const app = new Hono();

	let configWritten = false;
	let chosenMode: "file" | "hybrid" | "namespace" | null = null;

	const setupPage = (): string =>
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Ordna setup</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  p.lede { color: #666; margin-top: 0; }
  fieldset { border: 1px solid #ddd; border-radius: 6px; padding: 1rem 1.25rem; margin: 1.5rem 0; }
  legend { font-weight: 600; padding: 0 0.5rem; }
  label { display: block; padding: 0.5rem 0; cursor: pointer; }
  label code { background: #f3f3f6; padding: 1px 6px; border-radius: 3px; font-size: 0.9rem; }
  label small { display: block; color: #666; margin-left: 1.6rem; margin-top: 0.15rem; }
  button { background: #2563eb; color: white; border: 0; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-size: 1rem; }
  button:hover { background: #1d4ed8; }
  .done { background: #dcfce7; border: 1px solid #86efac; padding: 1rem 1.25rem; border-radius: 6px; }
</style>
</head>
<body>
<h1>Ordna setup</h1>
<p class="lede">${escapeHtml(args.reason)}</p>
${
	configWritten
		? `<div class="done">
  <p><strong>Storage mode set to <code>${escapeHtml(chosenMode ?? "")}</code>.</strong></p>
  <p>Restart the server (<code>Ctrl-C</code>, then <code>ordna web</code>) to load the board.</p>
</div>`
		: `<form method="post" action="/api/setup-mode">
  <fieldset>
    <legend>Pick a storage mode</legend>
    <label><input type="radio" name="storage" value="file" checked /> <code>file</code> <small>Tasks as markdown in <code>tasks/</code> (default, recommended)</small></label>
    <label><input type="radio" name="storage" value="hybrid" /> <code>hybrid</code> <small>Tasks as files + synced ID allocator + audit log in git</small></label>
    <label><input type="radio" name="storage" value="namespace" /> <code>namespace</code> <small>Tasks as git refs; working tree stays clean</small></label>
  </fieldset>
  <button type="submit">Save and continue</button>
</form>`
}
</body>
</html>`;

	app.post("/api/setup-mode", async (c) => {
		const body = await c.req.parseBody();
		const storage = body.storage;
		if (
			storage !== "file" &&
			storage !== "hybrid" &&
			storage !== "namespace"
		) {
			return c.text("Invalid storage mode", 400);
		}
		writeStorageConfig(args.cwd, storage);
		configWritten = true;
		chosenMode = storage;
		return c.redirect("/", 303);
	});

	app.all("*", (c) => c.html(setupPage()));

	const server = serve({ fetch: app.fetch, port, hostname: host });
	await new Promise<void>((resolve) => {
		if (server.listening) resolve();
		else server.once("listening", () => resolve());
	});
	const address = server.address();
	const actualPort =
		typeof address === "object" && address !== null ? address.port : port;

	const close = async (): Promise<void> => {
		await new Promise<void>((r) => {
			const s = server as unknown as { close: (cb: () => void) => void };
			s.close(() => r());
		});
	};

	return { port: actualPort, close, context: null, needsSetup: true };
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

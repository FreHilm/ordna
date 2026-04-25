import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createContext as createStoreContext, watchTasks, type StoreContext } from "@ordna/core";
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
	context: StoreContext;
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
	const ctx = createStoreContext(options.cwd);
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
				"Ordna server is running. Client bundle missing — run `pnpm --filter @ordna/web build:client`.",
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
		const opener =
			process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
		try {
			spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
		} catch {
			// Best-effort; ignore.
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

	return { port: actualPort, close, context: ctx };
}

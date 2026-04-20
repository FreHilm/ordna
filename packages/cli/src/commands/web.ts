import { runWeb } from "@ordna/web";
import { c } from "../colors.js";

export interface WebOptions {
	port?: number;
	host?: string;
	noOpen?: boolean;
}

export async function runWebCommand(options: WebOptions = {}): Promise<void> {
	const handle = await runWeb({
		port: options.port,
		host: options.host,
		openBrowser: !options.noOpen,
	});
	const url = `http://${options.host ?? "127.0.0.1"}:${handle.port}`;
	console.log(c.green(`Ordna web running at ${c.bold(url)}`));
	console.log(c.dim("Press Ctrl+C to stop."));

	let shuttingDown = false;
	const shutdown = async (): Promise<void> => {
		if (shuttingDown) {
			console.log(c.dim("Forcing exit."));
			process.exit(1);
		}
		shuttingDown = true;
		console.log(c.dim("Shutting down…"));
		await handle.close();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

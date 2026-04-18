import { runWeb } from "./start.js";

const handle = await runWeb({ openBrowser: false });
console.log(`Ordna server running on http://127.0.0.1:${handle.port}`);
console.log("Vite dev server proxies /api and /ws here. Run `pnpm dev:client` in another shell.");

const shutdown = async (): Promise<void> => {
	await handle.close();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

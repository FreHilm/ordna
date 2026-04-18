#!/usr/bin/env node
import { buildProgram } from "../cli.js";

async function main(): Promise<void> {
	const program = buildProgram();
	await program.parseAsync(process.argv);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});

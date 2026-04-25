import { Command } from "commander";
import type { Priority } from "@frehilm/ordna-core";
import { runAssign } from "./commands/assign.js";
import { runCommit } from "./commands/commit.js";
import { runCreate } from "./commands/create.js";
import { runInit } from "./commands/init.js";
import { runList } from "./commands/list.js";
import { runMove } from "./commands/move.js";
import { runShow } from "./commands/show.js";
import { runWebCommand } from "./commands/web.js";

export function buildProgram(): Command {
	const program = new Command();

	program
		.name("ordna")
		.description("Git-native project management. Tasks as markdown.")
		.version("0.0.0");

	program
		.command("init")
		.description("Create .ordna/config.yaml and tasks/ if missing")
		.action(() => runInit());

	program
		.command("list")
		.alias("ls")
		.description("List tasks")
		.option("-s, --status <status>", "filter by status")
		.option("-a, --assignee <name>", "filter by assignee")
		.option("-t, --tag <tag>", "filter by tag")
		.action((opts) => runList(opts));

	program
		.command("show <id>")
		.description("Show a task")
		.action((id: string) => runShow(id));

	program
		.command("create <title...>")
		.description("Create a new task")
		.option("-a, --assignee <name>", "assignee")
		.option("-p, --priority <level>", "high | medium | low")
		.option("-t, --tag <tag...>", "one or more tags")
		.option("-d, --depends-on <id...>", "one or more dependency IDs")
		.option("-s, --status <status>", "initial status")
		.action((titleParts: string[], opts) =>
			runCreate(titleParts.join(" "), {
				assignee: opts.assignee,
				priority: opts.priority as Priority | undefined,
				tags: opts.tag,
				dependsOn: opts.dependsOn,
				status: opts.status,
			}),
		);

	program
		.command("move <id> <status>")
		.description("Move a task to a different status")
		.action((id: string, status: string) => runMove(id, status));

	program
		.command("assign <id> [name]")
		.description("Assign a task (omit name to unassign)")
		.action((id: string, name?: string) => runAssign(id, name));

	program
		.command("commit")
		.description("Stage tasks/ and git commit")
		.option("-m, --message <msg>", "commit message", "chore(tasks): update")
		.action((opts) => runCommit(opts.message));

	program
		.command("web")
		.description("Start the local web Kanban (opens browser)")
		.option("-p, --port <port>", "port (default from config)", (v) => Number.parseInt(v, 10))
		.option("-h, --host <host>", "host", "127.0.0.1")
		.option("--no-open", "do not open browser")
		.action((opts) => runWebCommand(opts));

	program
		.command("board")
		.description("Open the Kanban TUI (default)")
		.action(async () => {
			const { runBoard } = await import("./tui/index.js");
			await runBoard();
		});

	program.action(async () => {
		const { runBoard } = await import("./tui/index.js");
		await runBoard();
	});

	return program;
}

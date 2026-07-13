#!/usr/bin/env node
import { createRequire } from "node:module";
import { SerialPort } from "./index.js";

const HELP = `tiny-serial — list serial ports

Usage:
  tiny-serial list [--json]   List available serial ports (default command)
  tiny-serial --help          Show this help
  tiny-serial --version       Show the version

Options:
  --json   Output the port list as JSON
`;

function version(): string {
	try {
		const require = createRequire(__filename);
		return require("../package.json").version as string;
	} catch {
		return "unknown";
	}
}

async function main(argv: string[]): Promise<number> {
	const args = argv.slice(2);

	if (args.includes("-h") || args.includes("--help")) {
		process.stdout.write(HELP);
		return 0;
	}
	if (args.includes("--version") || args.includes("-v")) {
		process.stdout.write(`${version()}\n`);
		return 0;
	}

	const cmd = args.find((a) => !a.startsWith("-")) ?? "list";
	if (cmd !== "list") {
		process.stderr.write(`tiny-serial: unknown command '${cmd}'\n\n${HELP}`);
		return 1;
	}

	const ports = await SerialPort.list();

	if (args.includes("--json")) {
		process.stdout.write(`${JSON.stringify(ports, null, 2)}\n`);
		return 0;
	}

	if (ports.length === 0) {
		process.stdout.write("No serial ports found.\n");
		return 0;
	}

	const width = Math.max(4, ...ports.map((p) => p.path.length));
	process.stdout.write(`${"PATH".padEnd(width)}  TYPE\n`);
	for (const p of ports) {
		process.stdout.write(`${p.path.padEnd(width)}  ${p.portType}\n`);
	}
	return 0;
}

main(process.argv)
	.then((code) => process.exit(code))
	.catch((err: unknown) => {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`tiny-serial: ${msg}\n`);
		process.exit(1);
	});

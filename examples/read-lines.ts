// Open a port and print each newline-terminated line the device sends.
//
//   bun examples/read-lines.ts /dev/ttyUSB0
//   SERIAL_PORT=/dev/cu.usbmodem1101 bun examples/read-lines.ts
//
// In your own project:  import { SerialPort, ReadlineParser } from "@liminal-machines-co/serial";
import { ReadlineParser, SerialPort } from "../src/index.js";

async function main() {
	const path = process.argv[2] ?? process.env.SERIAL_PORT;
	if (!path) {
		console.error("Usage: bun examples/read-lines.ts <port>");
		console.error("Tip: `npx liminal-serial list` shows available ports.");
		process.exit(1);
	}

	const port = new SerialPort({ path, baudRate: 9600 });

	// A ReadlineParser buffers the byte stream and emits one 'data' event per
	// line, re-joining lines split across reads. The delimiter (default "\n") is
	// stripped from each emitted line.
	const lines = port.pipe(new ReadlineParser());
	lines.on("data", (line) => console.log("←", line));

	port.on("error", (err: Error) => console.error("serial error:", err.message));

	await port.open();
	console.log(`listening on ${path} @ 9600 — press Ctrl+C to quit`);

	process.on("SIGINT", async () => {
		await port.close();
		process.exit(0);
	});
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

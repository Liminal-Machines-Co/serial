// Send a command and print the device's reply (request/response).
// Works with the firmware in arduino/test-device/ — "PING" replies "PONG".
//
//   bun examples/write-and-read.ts /dev/ttyUSB0 PING
//   bun examples/write-and-read.ts /dev/cu.usbmodem1101 "ECHO hello"
//
// In your own project:  import { SerialPort, ReadlineParser } from "tiny-serial";
import { ReadlineParser, SerialPort } from "../src/index.js";

async function main() {
	const path = process.argv[2] ?? process.env.SERIAL_PORT;
	const message = process.argv[3] ?? "PING";
	if (!path) {
		console.error("Usage: bun examples/write-and-read.ts <port> [message]");
		process.exit(1);
	}

	const port = new SerialPort({ path, baudRate: 9600 });
	const lines = port.pipe(new ReadlineParser());

	await port.open();

	// Print the first line the device sends back, then close.
	lines.once("data", async (line: Buffer) => {
		console.log("reply:", line.toString());
		await port.close();
	});

	console.log("→", message);
	await port.write(`${message}\n`);
	await port.drain(); // resolve once the bytes have actually left the port

	// Safety net: give up after 2s if the device never answers.
	setTimeout(async () => {
		console.error("no reply within 2s");
		await port.close();
		process.exit(1);
	}, 2000);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

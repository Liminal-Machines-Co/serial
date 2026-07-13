// List the serial ports available on this machine.
//
//   bun examples/list-ports.ts
//   npx tsx examples/list-ports.ts
//
// In your own project the import is:  import { SerialPort } from "@liminal-machines-co/serial";
import { SerialPort } from "../src/index.js";

async function main() {
	const ports = await SerialPort.list();

	if (ports.length === 0) {
		console.log("No serial ports found.");
		return;
	}
	for (const p of ports) {
		console.log(`${p.path}  (${p.portType})`);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

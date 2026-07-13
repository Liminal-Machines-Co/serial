//! Hardware-in-the-loop suite. Requires a real device running the firmware in
//! arduino/test-device/ connected to the port named by SERIAL_TEST_PORT.
//!
//!   SERIAL_TEST_PORT=/dev/cu.usbmodem1101 bun run test:hardware
//!   SERIAL_TEST_PORT=/dev/ttyUSB0 SERIAL_TEST_BAUD=9600 bun run test:hardware
//!
//! Skips entirely when SERIAL_TEST_PORT is unset, so it is a separate opt-in
//! suite that never runs in CI or on a dev machine by accident.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setTimeout } from "node:timers";
import { SerialPort } from "../../src/SerialPort.js";

const PORT = process.env.SERIAL_TEST_PORT;
const BAUD = Number(process.env.SERIAL_TEST_BAUD ?? 9600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!PORT) {
	console.log(`
--------

!IMPORTANT!
Port for test device was not provided. Use hardware tests like this:

--------

SERIAL_TEST_PORT=yourport bun run test:hardware

--------
    `);
}

describe.skipIf(!PORT)("hardware: arduino test-device", () => {
	let port: SerialPort;
	// Raw receive buffer accumulated straight off the port, so we can frame both
	// newline replies and raw binary responses ourselves.
	let rx = Buffer.alloc(0);

	const flush = () => {
		rx = Buffer.alloc(0);
	};

	async function readLine(timeoutMs = 3000): Promise<string> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const nl = rx.indexOf(0x0a);
			if (nl !== -1) {
				const line = rx.subarray(0, nl).toString().replace(/\r$/, "");
				rx = rx.subarray(nl + 1);
				return line;
			}
			await sleep(10);
		}
		throw new Error("timeout waiting for a line");
	}

	async function readBytes(n: number, timeoutMs = 3000): Promise<Buffer> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (rx.length >= n) {
				const out = rx.subarray(0, n);
				rx = rx.subarray(n);
				return out;
			}
			await sleep(10);
		}
		throw new Error(`timeout waiting for ${n} bytes`);
	}

	async function command(cmd: string): Promise<void> {
		flush();
		await port.write(`${cmd}\n`);
	}

	beforeAll(async () => {
		port = new SerialPort({ path: PORT as string, baudRate: BAUD });
		port.on("data", (d: Buffer) => {
			rx = Buffer.concat([rx, d]);
		});
		await port.open();

		// Many boards reset when the port opens; the firmware prints "ready"
		// once it is up. Wait for it (or time out) then clear the buffer.
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (rx.includes("ready")) break;
			await sleep(50);
		}

		flush();
	});

	afterAll(async () => {
		await port?.close();
	});

	test("PING -> PONG", async () => {
		await command("PING");
		expect(await readLine()).toBe("PONG");
	});

	test("ID returns the firmware identifier", async () => {
		await command("ID");
		expect(await readLine()).toBe("liminal-serial-test v1.0");
	});

	test("ECHO echoes its argument", async () => {
		await command("ECHO hello world");
		expect(await readLine()).toBe("hello world");
	});

	test("LINES streams N newline-framed lines", async () => {
		await command("LINES 3");
		expect(await readLine()).toBe("tick 1");
		expect(await readLine()).toBe("tick 2");
		expect(await readLine()).toBe("tick 3");
	});

	test("BINARY returns four raw bytes", async () => {
		await command("BINARY");
		const bytes = await readBytes(4);
		expect([...bytes]).toEqual([1, 2, 3, 4]);
	});
});

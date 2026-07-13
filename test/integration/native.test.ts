import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { open as fsOpen } from "node:fs/promises";
import { native } from "../helpers/native.js";
import { hasSocat, makePtyPair } from "../helpers/pty.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const unavailable = !hasSocat || !native?.NativeSerialPort;

test.skipIf(unavailable)(
	"native open/read/write/drain/close over a PTY pair",
	async () => {
		if (!native) return; // unreachable when not skipped; narrows the type
		const { proc, a, b } = await makePtyPair();
		await sleep(200);
		const peer = await fsOpen(b, "r+");

		// baudRate 0 -> skip termios config (PTYs have no real baud).
		const port = new native.NativeSerialPort();
		const received: Buffer[] = [];
		port.open(a, { baudRate: 0 }, (err, data) => {
			if (!err) received.push(data);
		});
		await sleep(150);

		// native write -> peer reads
		await port.write(Buffer.from("hello\n"));
		await port.drain();
		await sleep(150);
		const peerBuf = Buffer.alloc(64);
		const { bytesRead } = await peer.read(peerBuf, 0, 64, null);
		expect(peerBuf.subarray(0, bytesRead).toString()).toBe("hello\n");

		// peer write -> native read callback
		await peer.write(Buffer.from("world\n"));
		await sleep(200);
		expect(Buffer.concat(received).toString()).toBe("world\n");

		port.close(); // must join the read thread without hanging
		await peer.close();
		proc.kill();
		await sleep(100);
	},
);

test.skipIf(unavailable || process.platform === "win32")(
	"open() applies the full line config (dataBits/parity/stopBits)",
	async () => {
		if (!native) return; // unreachable when not skipped; narrows the type
		const { proc, a } = await makePtyPair();
		await sleep(200);

		const port = new native.NativeSerialPort();
		port.open(
			a,
			{ baudRate: 9600, dataBits: 7, parity: "even", stopBits: 2 },
			() => {},
		);
		await sleep(200);

		// Read the applied termios back off the device. macOS uses -f, Linux -F.
		const flag = process.platform === "darwin" ? "-f" : "-F";
		const stty = spawnSync("stty", [flag, a, "-a"]).stdout.toString();

		expect(stty).toMatch(/speed 9600/); // baudRate crossed the seam
		expect(stty).toMatch(/(^|\s)cstopb/); // 2 stop bits

		// Linux PTY driver (pty_set_termios) hard-overrides CSIZE to CS8 and clears PARENB.
		// We can only assert character size and parity on macOS/other platforms where PTYs retain these.
		if (process.platform !== "linux") {
			expect(stty).toMatch(/cs7/); // dataBits: 7
			expect(stty).toMatch(/(^|\s)parenb/); // parity enabled
			expect(stty).toMatch(/-parodd/); // even parity
		}

		port.close();
		proc.kill();
		await sleep(100);
	},
);

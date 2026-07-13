// End-to-end native smoke test. Requires a built addon (npm run build:native)
// and `socat` to create a virtual serial pair. Skips cleanly if either is
// missing so it can live in the default suite.
import { spawn, spawnSync } from "node:child_process";
import { open as fsOpen } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = new URL("..", import.meta.url).pathname;

const hasSocat = spawnSync("socat", ["-V"]).status === 0;
let native = null;
try {
	native = require("node-gyp-build")(root);
} catch {
	// no prebuilt/native binary available
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePtyPair() {
	return new Promise((resolve, reject) => {
		const proc = spawn("socat", [
			"-d",
			"-d",
			"pty,raw,echo=0",
			"pty,raw,echo=0",
		]);
		const paths = [];
		let buf = "";
		proc.stderr.on("data", (d) => {
			buf += d.toString();
			for (const m of buf.matchAll(/N PTY is (\/dev\/\S+)/g)) {
				if (!paths.includes(m[1])) paths.push(m[1]);
			}
			if (paths.length === 2) resolve({ proc, a: paths[0], b: paths[1] });
		});
		proc.on("error", reject);
		setTimeout(() => reject(new Error(`socat timeout; got: ${buf}`)), 3000);
	});
}

test("native open/read/write/drain/close over a PTY pair", async (t) => {
	if (!hasSocat) return t.skip("socat not installed");
	if (!native?.NativeSerialPort) return t.skip("no native binary built");

	const assert = (await import("node:assert/strict")).default;
	const { proc, a, b } = await makePtyPair();
	await sleep(200);
	const peer = await fsOpen(b, "r+");

	// baudRate 0 -> skip termios config (PTYs have no real baud).
	const port = new native.NativeSerialPort();
	const received = [];
	port.open(a, 0, (err, data) => {
		if (!err) received.push(data);
	});
	await sleep(150);

	await port.write(Buffer.from("hello\n"));
	await port.drain();
	await sleep(150);
	const peerBuf = Buffer.alloc(64);
	const { bytesRead } = await peer.read(peerBuf, 0, 64, null);
	assert.equal(peerBuf.subarray(0, bytesRead).toString(), "hello\n");

	await peer.write(Buffer.from("world\n"));
	await sleep(200);
	assert.equal(Buffer.concat(received).toString(), "world\n");

	port.close(); // must join the read thread without hanging
	await peer.close();
	proc.kill();
	await sleep(100);
});

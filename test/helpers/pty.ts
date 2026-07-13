import { type ChildProcess, spawn, spawnSync } from "node:child_process";

/** True when `socat` is on PATH — integration tests skip without it. */
export const hasSocat = spawnSync("socat", ["-V"]).status === 0;

export interface PtyPair {
	proc: ChildProcess;
	/** device path opened by the code under test */
	a: string;
	/** device path used by the test as the peer end */
	b: string;
}

/**
 * Creates a linked pseudo-terminal pair with socat and returns both device
 * paths. Bytes written to one end are readable on the other — a hardware-free
 * stand-in for a real serial link.
 */
export function makePtyPair(): Promise<PtyPair> {
	return new Promise((resolve, reject) => {
		const proc = spawn("socat", [
			"-d",
			"-d",
			"pty,raw,echo=0",
			"pty,raw,echo=0",
		]);
		const paths: string[] = [];
		let buf = "";
		proc.stderr?.on("data", (d: Buffer) => {
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

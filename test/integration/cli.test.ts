import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { native } from "../helpers/native.js";

const cli = resolve(__dirname, "..", "..", "src", "cli.ts");
const run = (...args: string[]) =>
	spawnSync("bun", [cli, ...args], { encoding: "utf8" });

test.skipIf(!native?.listPorts)(
	"`list --json` prints a JSON array of { path, portType }",
	() => {
		const res = run("list", "--json");
		expect(res.status).toBe(0);
		const ports = JSON.parse(res.stdout) as {
			path: string;
			portType: string;
		}[];
		expect(Array.isArray(ports)).toBe(true);
		for (const p of ports) {
			expect(typeof p.path).toBe("string");
			expect(typeof p.portType).toBe("string");
		}
	},
);

test("`--help` prints usage and exits 0", () => {
	const res = run("--help");
	expect(res.status).toBe(0);
	expect(res.stdout).toContain("liminal-serial");
	expect(res.stdout).toContain("list");
});

test("an unknown command exits non-zero", () => {
	const res = run("bogus");
	expect(res.status).toBe(1);
});

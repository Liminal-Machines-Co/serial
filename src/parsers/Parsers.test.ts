import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import { ByteLengthParser } from "./ByteLengthParser.js";
import { InterByteTimeoutParser } from "./InterByteTimeoutParser.js";
import { ReadlineParser } from "./ReadlineParser.js";
import { RegexParser } from "./RegexParser.js";

/** Feeds chunks through a transform and resolves with the emitted pieces. */
function run<T extends NodeJS.ReadWriteStream>(
	parser: T,
	chunks: (string | Buffer)[],
): Promise<Buffer[]> {
	const out: Buffer[] = [];
	parser.on("data", (d: Buffer | string) =>
		out.push(Buffer.isBuffer(d) ? d : Buffer.from(d)),
	);
	const src = Readable.from(
		(function* () {
			for (const c of chunks) yield typeof c === "string" ? Buffer.from(c) : c;
		})(),
	);
	return new Promise((resolve, reject) => {
		src.pipe(parser as unknown as NodeJS.WritableStream);
		parser.on("end", () => resolve(out));
		parser.on("error", reject);
	});
}

test("ReadlineParser splits on newline across chunk boundaries", async () => {
	const out = await run(new ReadlineParser(), ["foo\nba", "r\nbaz\n"]);
	expect(out.map((b) => b.toString())).toEqual(["foo", "bar", "baz"]);
});

test("ReadlineParser honours a custom delimiter and includeDelimiter", async () => {
	const out = await run(
		new ReadlineParser({ delimiter: "\r\n", includeDelimiter: true }),
		["a\r\nb\r\n"],
	);
	expect(out.map((b) => b.toString())).toEqual(["a\r\n", "b\r\n"]);
});

test("ReadlineParser flushes a trailing partial line", async () => {
	const out = await run(new ReadlineParser(), ["done\nleftover"]);
	expect(out.map((b) => b.toString())).toEqual(["done", "leftover"]);
});

test("ByteLengthParser emits fixed-size frames and buffers remainder", async () => {
	const out = await run(new ByteLengthParser({ length: 2 }), [
		Buffer.from([1, 2, 3]),
		Buffer.from([4, 5]),
	]);
	// last [5] is the flushed remainder
	expect(out.map((b) => [...b])).toEqual([[1, 2], [3, 4], [5]]);
});

test("ByteLengthParser rejects a length below 1", () => {
	expect(() => new ByteLengthParser({ length: 0 })).toThrow(TypeError);
});

test("RegexParser splits on a pattern", async () => {
	const out = await run(new RegexParser({ regex: /\s+/ }), ["a  b\tc"]);
	expect(out.map((b) => b.toString())).toEqual(["a", "b", "c"]);
});

test("InterByteTimeoutParser emits after the inter-byte gap", async () => {
	const parser = new InterByteTimeoutParser({ interval: 10 });
	const out: Buffer[] = [];
	parser.on("data", (d: Buffer) => out.push(d));
	parser.write(Buffer.from("hel"));
	parser.write(Buffer.from("lo"));
	await new Promise((r) => setTimeout(r, 30));
	expect(Buffer.concat(out).toString()).toBe("hello");
	parser.end();
});

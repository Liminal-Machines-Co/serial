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
): Promise<(Buffer | string)[]> {
	const out: (Buffer | string)[] = [];
	parser.on("data", (d: Buffer | string) => out.push(d));
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
	expect(out).toEqual(["foo", "bar", "baz"]);
});

test("ReadlineParser honours a custom delimiter and includeDelimiter", async () => {
	const out = await run(
		new ReadlineParser({ delimiter: "\r\n", includeDelimiter: true }),
		["a\r\nb\r\n"],
	);
	expect(out).toEqual(["a\r\n", "b\r\n"]);
});

test("ReadlineParser flushes a trailing partial line", async () => {
	const out = await run(new ReadlineParser(), ["done\nleftover"]);
	expect(out).toEqual(["done", "leftover"]);
});

test("ReadlineParser emits Buffer when raw is true", async () => {
	const out = await run(new ReadlineParser({ raw: true }), ["foo\nbar\n"]);
	expect(out.every((c) => Buffer.isBuffer(c))).toBe(true);
	expect((out as Buffer[]).map((b) => b.toString())).toEqual(["foo", "bar"]);
});

test("ByteLengthParser emits fixed-size frames and buffers remainder", async () => {
	const out = await run(new ByteLengthParser({ length: 2, raw: true }), [
		Buffer.from([1, 2, 3]),
		Buffer.from([4, 5]),
	]);
	// last [5] is the flushed remainder
	expect((out as Buffer[]).map((b) => [...b])).toEqual([[1, 2], [3, 4], [5]]);
});

test("ByteLengthParser emits string by default", async () => {
	const out = await run(new ByteLengthParser({ length: 2 }), [
		Buffer.from("abcd"),
	]);
	expect(out).toEqual(["ab", "cd"]);
});

test("ByteLengthParser rejects a length below 1", () => {
	expect(() => new ByteLengthParser({ length: 0 })).toThrow(TypeError);
});

test("RegexParser splits on a pattern", async () => {
	const out = await run(new RegexParser({ regex: /\s+/ }), ["a  b\tc"]);
	expect(out).toEqual(["a", "b", "c"]);
});

test("InterByteTimeoutParser emits after the inter-byte gap", async () => {
	const parser = new InterByteTimeoutParser({ interval: 10 });
	const out: string[] = [];
	parser.on("data", (d) => out.push(d));
	parser.write(Buffer.from("hel"));
	parser.write(Buffer.from("lo"));
	await new Promise((r) => setTimeout(r, 30));
	expect(out.join("")).toBe("hello");
	parser.end();
});

test("InterByteTimeoutParser emits Buffer when raw is true", async () => {
	const parser = new InterByteTimeoutParser({ interval: 10, raw: true });
	const out: Buffer[] = [];
	parser.on("data", (d) => out.push(d));
	parser.write(Buffer.from("hello"));
	await new Promise((r) => setTimeout(r, 30));
	expect(Buffer.concat(out).toString()).toBe("hello");
	parser.end();
});

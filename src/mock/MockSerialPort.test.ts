import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { ReadlineParser } from "../parsers/ReadlineParser.js";
import { MockSerialPort } from "./MockSerialPort.js";

const collect = (stream: NodeJS.ReadableStream): Buffer[] => {
	const chunks: Buffer[] = [];
	stream.on("data", (c: Buffer) => chunks.push(c));
	return chunks;
};

test("open/close toggle isOpen and emit events", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	assert.equal(port.isOpen, false);

	const opened = once(port, "open");
	await port.open();
	await opened;
	assert.equal(port.isOpen, true);

	const closed = once(port, "close");
	await port.close();
	await closed;
	assert.equal(port.isOpen, false);
});

test("mockReply injects a response when the trigger is written", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	port.mockReply("PING", "PONG\n");
	await port.open();

	const chunks = collect(port);
	await port.write("PING");
	await once(port, "data");
	assert.equal(Buffer.concat(chunks).toString(), "PONG\n");
});

test("getWrittenData captures everything written", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	await port.open();
	await port.write("AT");
	await port.write(Buffer.from("+GMR\r\n"));
	assert.equal(port.getWrittenData().toString(), "AT+GMR\r\n");
});

test("timeout fault suppresses replies", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	port.mockReply("PING", "PONG\n").simulateFault("timeout");
	await port.open();

	let got = false;
	port.on("data", () => {
		got = true;
	});
	await port.write("PING");
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(got, false);
});

test("disconnect fault ends the stream and emits close", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	await port.open();
	const closed = once(port, "close");
	const ended = once(port, "end");
	port.resume();
	port.simulateFault("disconnect");
	await Promise.all([closed, ended]);
	assert.equal(port.isOpen, false);
});

test("composes with ReadlineParser into framed lines", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	port.mockReply("GO", "one\ntwo\nthr");
	await port.open();

	const parser = port.pipe(new ReadlineParser());
	const lines: string[] = [];
	parser.on("data", (line: Buffer) => lines.push(line.toString()));

	await port.write("GO");
	await new Promise((r) => setTimeout(r, 20));
	assert.deepEqual(lines, ["one", "two"]); // "thr" is buffered, no delimiter yet
});

test("pin changes emit pin-change events", async () => {
	const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
	const evt = once(port, "pin-change");
	port.pins.setDTR(true);
	const [payload] = await evt;
	assert.deepEqual(payload, { pin: "DTR", value: true });
	assert.equal(port.pins.getDTR(), true);
});

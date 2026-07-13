# Examples

Runnable examples plus a quick tour of the API.

| File | What it shows |
| --- | --- |
| [`list-ports.ts`](list-ports.ts) | Enumerate available ports |
| [`read-lines.ts`](read-lines.ts) | Open a port and read newline-delimited lines |
| [`write-and-read.ts`](write-and-read.ts) | Send a command and read the reply |

## Running them

The examples are TypeScript, run directly with [Bun](https://bun.sh) or
[tsx](https://github.com/privatenumber/tsx) (no build step for the examples
themselves — only the native addon needs building):

```sh
npm install
npm run build:native       # build the native addon -> prebuilds/
bun examples/list-ports.ts
bun examples/read-lines.ts /dev/ttyUSB0
# or, without Bun:
npx tsx examples/list-ports.ts
```

Find a port with `npx liminal-serial list`. The examples import from `../src`; in
your own project you would instead `import ... from "@liminal-machines-co/serial"`.

---

## API tour

### Install

```sh
npm install @liminal-machines-co/serial
```

### List ports

```js
import { SerialPort } from "@liminal-machines-co/serial";

const ports = await SerialPort.list(); // [{ path, portType }, ...]
```

### Open a port

A `SerialPort` is a Node `Readable` stream. Construct it with a path and baud
rate, then `open()`:

```js
const port = new SerialPort({ path: "/dev/ttyUSB0", baudRate: 9600 });
await port.open();
```

Other line settings are optional and default to `8N1`:

```js
new SerialPort({
  path: "/dev/ttyUSB0",
  baudRate: 115200,
  dataBits: 8,        // 5 | 6 | 7 | 8
  parity: "none",     // "none" | "odd" | "even" | "mark" | "space"
  stopBits: 1,        // 1 | 1.5 | 2
  rtscts: false,      // hardware flow control
});
```

### Write

`write()` accepts a `Buffer` or string; `drain()` resolves once the bytes have
physically left the port:

```js
await port.write("AT\r\n");
await port.drain();
```

### Listen for newline-delimited lines

Incoming bytes arrive in arbitrary chunks, so pipe the port through a
`ReadlineParser` to get one event per line (split reassembled across reads, the
delimiter stripped):

```js
import { ReadlineParser } from "@liminal-machines-co/serial";

const lines = port.pipe(new ReadlineParser()); // default delimiter "\n"
lines.on("data", (line) => console.log(line.toString()));
```

Because a `SerialPort` is just a `Readable`, the raw byte stream is also
available directly via `port.on("data", ...)`. Other parsers ship too:
`ByteLengthParser`, `InterByteTimeoutParser`, `RegexParser`.

### Close

```js
await port.close();
```

### Test without hardware

`MockSerialPort` is a drop-in for `SerialPort` (same interface) that needs no
device — handy for unit tests:

```js
import { MockSerialPort } from "@liminal-machines-co/serial";

const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
port.mockReply("PING", "PONG\n"); // queue a canned response
await port.open();
await port.write("PING");          // emits "PONG\n" on 'data'
```

# @liminal-machines-co/serial

Serial port lib for Node.js. Zig-backed native core. Prebuilt binaries bundled — no build step. Node ≥ 18.

`SerialPort` is a Node `Readable`. All stream APIs apply (`.pipe`, `.on("data")`, backpressure, etc).

## Import

```ts
import {
  SerialPort, MockSerialPort,
  ReadlineParser, ByteLengthParser, InterByteTimeoutParser, RegexParser,
  validateOptions,
} from "@liminal-machines-co/serial";
```

Types: `SerialPortOptions`, `PortInfo`, `PinName`, `ISerialPort`, `MockPins`, parser option types.

## Quick use

```ts
const port = new SerialPort({ path: "/dev/ttyUSB0", baudRate: 115200 });
await port.open();
port.pipe(new ReadlineParser()).on("data", (line) => console.log(line));
await port.write("AT\r\n");
await port.close();

const ports = await SerialPort.list(); // [{ path, portType }, ...]
```

## SerialPort

Constructor: `new SerialPort(options: SerialPortOptions)`. Validates options in ctor (throws `TypeError`).

`SerialPortOptions`:
- `path: string` — required.
- `baudRate: number` — required, non-negative. `0` = sentinel, skips baud config (for PTYs).
- `dataBits?: 5|6|7|8`
- `stopBits?: 1|1.5|2`
- `parity?: "none"|"odd"|"even"|"mark"|"space"`
- `rtscts?: boolean` — hardware handshake
- `xon?: boolean`, `xoff?: boolean` — software handshake

Handshake precedence: `rtscts` → hardware; else `xon||xoff` → software; else none.

Methods:
- `open(): Promise<void>` — throws if already open.
- `close(): Promise<void>` — no-op if not open.
- `write(chunk: Buffer|string): Promise<void>` — string → `Buffer.from(chunk)` (utf8). Throws if not open.
- `drain(): Promise<void>` — wait TX flush. Throws if not open.
- `path: string` (readonly), `isOpen: boolean`.
- static `list(): Promise<PortInfo[]>` → `{ path, portType }[]`.

Events: `open`, `close`, `error`, `data` (Readable). Read errors surface via `"error"`.

`_destroy` (stream `.destroy()`) auto-closes if open.

## CLI

```sh
npx liminal-serial list          # table
npx liminal-serial list --json   # JSON
```

## Parsers

Transform streams. `.pipe()` onto a port. All except `RegexParser` extend `BufferedTransform`; default emit **decoded string** (`encoding` default `"utf8"`) — pass `raw: true` to emit `Buffer`. Standard `TransformOptions` accepted too.

- `ReadlineParser({ delimiter?="\n", includeDelimiter?=false, encoding?, raw? })` — split on delimiter. Delimiter string|Buffer; empty throws.
- `ByteLengthParser({ length, encoding?, raw? })` — fixed `length`-byte frames. `length` ≥ 1 else throws.
- `InterByteTimeoutParser({ interval, maxBufferSize?=65536, encoding?, raw? })` — emit after `interval` ms inter-byte gap; force-flush at `maxBufferSize`. `interval` ≥ 1 else throws. Flushes buffer on stream end.
- `RegexParser({ regex, encoding? })` — split on pattern (RegExp|string|Buffer). Always emits **string** (no `raw`). Drops empty segments. Remainder held till next chunk / flush.

## MockSerialPort — hardware-free testing

Drop-in `ISerialPort`. Same ctor/options as `SerialPort`. `open`/`close`/`drain` are no-ops (no native).

```ts
const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
port.mockReply("PING", "PONG\n");   // trigger, response, delay?=0 (ms)
await port.open();
await port.write("PING");           // emits "PONG\n" on 'data' after delay
port.getWrittenData();              // Buffer of all writes
port.clearWrittenData();
port.simulateFault("disconnect");   // also: "fragmentation" | "timeout"
port.clearFault("timeout");
```

- `mockReply` match is **partial** (`write` data *contains* trigger). First registered match per write fires only. Chainable.
- Faults: `disconnect` = close + push(null) immediately; `fragmentation` = replies pushed byte-by-byte; `timeout` = replies suppressed.
- `pins: MockPins` — get/set CTS/DSR/DCD/DTR/RTS; set emits `"pin-change"` `{ pin, value }`. (Mock only.)

## Platform support

| Platform | Enumeration | Serial IO |
|---|---|---|
| macOS (arm64, x64) | ✅ | ✅ |
| Linux (x64, arm64) | ✅ | ✅ |
| Windows (x64) | ❌ planned | ❌ loads but methods throw |

## Gotchas

- **Windows**: binary loads, but serial IO + enumeration not implemented — methods throw.
- **baudRate 0**: valid sentinel that skips baud config (PTY use), not an error.
- **Parser default = string, not Buffer**: pass `raw: true` for binary framing.
- **RegexParser** ignores `raw` (always string) and drops empty split segments.
- **mockReply partial match + first-wins**: order registrations by priority; broad triggers can shadow later ones.
- **Native binding loaded lazily/once** on first `open`/`list`. Importing the barrel (mock/parsers only) never touches native — mock + parser code runs without a native binary.
- **write string encoding** is utf8; pass a `Buffer` for other encodings / binary.

# tiny-serial

A small, fast serial port library for Node.js with a **Zig**-backed native core.
Because Zig cross-compiles every target from a single machine and Node-API
symbols resolve at load time, prebuilt binaries for all platforms are built in
one CI job and bundled into the published package — **no compiler, no
node-gyp, no install scripts** on the consumer's machine.

## Install

```sh
npm install tiny-serial
```

The correct prebuilt binary is selected at load time by `node-gyp-build` from
`prebuilds/<platform>-<arch>/serial.node`.

## Usage

```ts
import { SerialPort, ReadlineParser } from "tiny-serial";

const port = new SerialPort({ path: "/dev/ttyUSB0", baudRate: 115200 });
await port.open();

port.pipe(new ReadlineParser()).on("data", (line) => console.log(line));
await port.write("AT\r\n");

const ports = await SerialPort.list(); // [{ path, portType }, ...]
```

### Parsers

Transform streams you compose onto the port with `.pipe()`:

- `ReadlineParser` — split on a delimiter (default `\n`)
- `ByteLengthParser` — fixed-size `length`-byte frames
- `InterByteTimeoutParser` — emit after an inter-byte gap
- `RegexParser` — split on a pattern

### Testing without hardware

`MockSerialPort` is a drop-in for `SerialPort` (same `ISerialPort` interface)
that needs no native build:

```ts
import { MockSerialPort } from "tiny-serial";

const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
port.mockReply("PING", "PONG\n");
await port.open();
await port.write("PING"); // emits "PONG\n" on 'data'
port.getWrittenData();     // Buffer of everything written
port.simulateFault("disconnect");
```

## Platform support

| Platform            | Enumeration | Serial IO |
| ------------------- | ----------- | --------- |
| macOS (arm64, x64)  | ✅          | ✅        |
| Linux (x64, arm64)  | ✅          | ✅        |
| Windows (x64)       | ⏳ follow-up | ⏳ follow-up (loads; methods throw) |

Windows cross-compiles and loads (the binary links against an import library
generated from `node_api.def`), but native serial IO and port enumeration are
not yet implemented.

## Development

Requires [Zig 0.16.0](https://ziglang.org/download/) and Node ≥ 18.

```sh
npm install
npm run build:native      # build the addon for the host -> prebuilds/
npm run build:prebuilds    # cross-compile every target
npm test                   # mock + parser unit tests (no hardware)
npm run test:native        # end-to-end over a socat PTY pair (needs socat)
```

### How it fits together

- `src/napi/*.zig` — native addon. `root.zig` registers the module;
  `serial_port_posix.zig` implements the `NativeSerialPort` class (background
  read thread → threadsafe function; async-work Promises for write/drain);
  `enumerate.zig` lists ports by scanning `/dev`.
- `src/*.ts` — the JS-facing layer: `SerialPort` (a `Readable`), `MockSerialPort`,
  parsers, and option validation.
- `index.js` — loads the right prebuilt `.node` via `node-gyp-build`.
- Native config uses [ZigEmbeddedGroup/serial](https://github.com/ZigEmbeddedGroup/serial);
  N-API headers come from [node-api-headers](https://github.com/nodejs/node-api-headers).

## License

MIT

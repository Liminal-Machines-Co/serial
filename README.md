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

### CLI

The package ships a small `tiny-serial` command for listing ports:

```sh
npx tiny-serial list          # table of available ports
npx tiny-serial list --json   # machine-readable JSON
```

```
PATH                             TYPE
/dev/cu.usbserial-1420           cu
/dev/cu.Bluetooth-Incoming-Port  cu
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
```

Releases are cut with `npm version` and published by CI — see
[RELEASING.md](RELEASING.md).

### Testing

Tests run on the [Bun](https://bun.sh) test runner (Bun executes the TypeScript
directly — no compile step). There are three suites:

```sh
npm test               # unit: mock + parsers, pure JS, no hardware
npm run test:integration   # native addon over a socat PTY pair (needs socat + a host build)
npm run test:hardware      # hardware-in-the-loop against a real device (opt-in, see below)
npm run typecheck:test     # type-check the test sources
```

- **Unit** (`src/**/*.test.ts`) — the mock and parsers, fully hermetic.
- **Integration** (`test/integration/`) — drives the real native binding through a
  virtual serial pair created with `socat`; also asserts the line config
  (dataBits/parity/stopBits) reaches the device via `stty`. Run `npm run build:native`
  first. Skips automatically if `socat` or a prebuilt binary is missing.
- **Hardware** (`test/hardware/`) — a separate opt-in suite that talks to a real
  device flashed with the firmware in [`arduino/test-device/`](arduino/test-device/).
  It only runs when you point it at a port:

  ```sh
  SERIAL_TEST_PORT=/dev/cu.usbmodem1101 npm run test:hardware
  SERIAL_TEST_PORT=/dev/ttyUSB0 SERIAL_TEST_BAUD=9600 npm run test:hardware
  ```

  Without `SERIAL_TEST_PORT` set, the suite skips — so it never runs in CI or by
  accident. It exercises the firmware protocol (PING→PONG, ID, ECHO, LINES, BINARY)
  through the public `SerialPort` API.

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

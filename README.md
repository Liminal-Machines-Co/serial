# @liminal-machines-co/serial

A small, fast serial port library for Node.js with a **Zig**-backed native core.
Zig cross-compiles every target from a single machine, and Node-API symbols
resolve at load time — so prebuilt binaries for all platforms are built in one CI
job and bundled into the package. Just install and go.

## Install

```sh
npm install @liminal-machines-co/serial
```

`node-gyp-build` picks the right prebuilt binary from
`prebuilds/<platform>-<arch>/serial.node` at load time.

## Usage

```ts
import { SerialPort, ReadlineParser } from "@liminal-machines-co/serial";

const port = new SerialPort({ path: "/dev/ttyUSB0", baudRate: 115200 });
await port.open();

port.pipe(new ReadlineParser()).on("data", (line) => console.log(line));
await port.write("AT\r\n");

const ports = await SerialPort.list(); // [{ path, portType }, ...]
```

A `SerialPort` is a Node `Readable`, so everything you know about streams
applies. See [`examples/`](examples/) for runnable scripts.

### CLI

List ports without writing any code:

```sh
npx liminal-serial list          # table of available ports
npx liminal-serial list --json   # machine-readable JSON
```

```
PATH                             TYPE
/dev/cu.usbserial-1420           cu
/dev/cu.Bluetooth-Incoming-Port  cu
```

### Parsers

Transform streams you compose onto a port with `.pipe()`:

- `ReadlineParser` — split on a delimiter (default `\n`)
- `ByteLengthParser` — fixed-size `length`-byte frames
- `InterByteTimeoutParser` — emit after an inter-byte gap
- `RegexParser` — split on a pattern

### Testing without hardware

`MockSerialPort` is a drop-in for `SerialPort`, so
you can test your serial logic with no device attached:

```ts
import { MockSerialPort } from "@liminal-machines-co/serial";

const port = new MockSerialPort({ path: "/dev/mock", baudRate: 9600 });
port.mockReply("PING", "PONG\n");
await port.open();
await port.write("PING"); // emits "PONG\n" on 'data'
port.getWrittenData(); // Buffer of everything written
port.simulateFault("disconnect");
```

## Platform support

| Platform           | Enumeration | Serial IO                         |
| ------------------ | ----------- | --------------------------------- |
| macOS (arm64, x64) | ✅          | ✅                                |
| Linux (x64, arm64) | ✅          | ✅                                |
| Windows (x64)      | ⏳ planned  | ⏳ planned (loads; methods throw) |

Windows cross-compiles and loads today (its import library is generated from
`node_api.def`), but native serial IO and port enumeration aren't wired up yet —
a great first contribution if you're on Windows.

## Contributing

You'll need [Zig 0.16.0](https://ziglang.org/download/) and Node ≥ 18.

```sh
npm install
npm run build:native      # build the addon for your host -> prebuilds/
npm run build:prebuilds   # cross-compile every target
```

Releases go out via `npm version` + a git tag — see [RELEASING.md](RELEASING.md).
Architecture, decisions, and conventions live in [CLAUDE.md](CLAUDE.md).

### Tests

Tests run on the [Bun](https://bun.sh) runner (it executes the TypeScript
directly — no compile step), in three suites:

```sh
npm test                 # unit: mock + parsers, pure JS, no hardware
npm run test:integration # native addon over a socat PTY pair (needs socat + a host build)
npm run test:hardware    # against a real device (opt-in, see below)
npm run typecheck:test   # type-check the test sources
```

- **Unit** (`src/**/*.test.ts`) — mock and parsers
- **Integration** (`test/integration/`) — drives the real native binding through a
  virtual serial pair made with `socat`, and checks the line config
  (dataBits/parity/stopBits) reaches the device via `stty`. Run
  `npm run build:native` first; skips automatically if `socat` or a binary is
  missing.
- **Hardware** (`test/hardware/`) — an opt-in suite that talks to a real device
  flashed with the firmware in [`arduino/test-device/`](arduino/test-device/).
  Point it at a port to run it:

  ```sh
  SERIAL_TEST_PORT=/dev/cu.usbmodem1101 npm run test:hardware
  ```

  With `SERIAL_TEST_PORT` unset it skips, so it never runs in CI or by accident.
  It exercises the firmware protocol (PING→PONG, ID, ECHO, LINES, BINARY) through
  the public `SerialPort` API.

### Overview

- `src/napi/*.zig` — the native addon. `root.zig` registers the module;
  `serial_port_posix.zig` implements `NativeSerialPort` (background read thread →
  threadsafe function; async-work Promises for write/drain); `enumerate.zig`
  lists ports by scanning `/dev`.
- `src/*.ts` — the JS layer: `SerialPort` (a `Readable`), `MockSerialPort`,
  parsers, and option validation.
- `index.js` — loads the right prebuilt `.node` via `node-gyp-build`.
- Line config uses [ZigEmbeddedGroup/serial](https://github.com/ZigEmbeddedGroup/serial);
  N-API headers come from [node-api-headers](https://github.com/nodejs/node-api-headers).

## License

MIT

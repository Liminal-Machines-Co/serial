# CLAUDE.md

Guidance for working in this repository.

## What this is

`@liminal-machines-co/serial` — a small serial-port library for Node.js with a **Zig**-backed
native core. The design goal is effortless multi-platform distribution: Zig
cross-compiles every target from one machine, and Node-API symbols resolve at
load time, so prebuilt binaries for all platforms are built in a single CI job
and bundled into the published package. Consumers need no compiler, no
node-gyp, and no install scripts.

## Stack

- **Native core:** Zig `0.16.0` (pinned — both Zig deps require it).
  - N-API: raw C API via `@import("c")`, a `translateC` of
    [`node-api-headers`](https://github.com/nodejs/node-api-headers). No zig-napi
    dependency (see decisions).
  - Serial line config: [`ZigEmbeddedGroup/serial`](https://github.com/ZigEmbeddedGroup/serial).
- **JS/TS layer:** TypeScript `5.7`, compiled with `tsc` (module `NodeNext`,
  package `"type": "commonjs"`). Node `>= 18`.
- **Loader:** `node-gyp-build` selects `prebuilds/<platform>-<arch>/serial.node`.
- **Tests:** [Bun](https://bun.sh) test runner (runs `.ts` directly).
- **Lint/format:** Biome (run via `bunx --bun @biomejs/biome`). Tabs, not spaces.
- **CI/release:** GitHub Actions; `npm version` + tag-triggered publish.

## Layout

```
src/
  napi/                 Zig native addon
    root.zig            napi_register_module_v1: defines class + listPorts
    napi.zig            ergonomic wrappers over the raw `c` N-API bindings
    serial_port.zig     OS dispatcher (posix impl vs windows stub)
    serial_port_posix.zig   NativeSerialPort: read thread + TSFN, async write/drain
    serial_port_windows.zig stub: loads + throws (native IO is a follow-up)
    enumerate.zig       listPorts() — scans /dev
  SerialPort.ts         public Readable wrapper over the native binding
  MockSerialPort.ts     standalone ISerialPort for hardware-free tests
  native.ts             memoized loader for the native binding (getNative)
  options.ts            validateOptions
  types.ts              interfaces (ISerialPort, INativeSerialPort, NativeOpenOptions, …)
  parsers/              BufferedTransform + Readline/ByteLength/InterByteTimeout/Regex
  cli.ts                `liminal-serial list` CLI (bin)
  index.ts              public barrel
index.js / index.d.ts   root native loader (node-gyp-build) + its types
build.zig / build.zig.zon  native build + deps
prebuilds/              built .node binaries (gitignored; produced by build)
test/                   integration + hardware suites + helpers
examples/               runnable .ts usage examples
arduino/test-device/    firmware fixture for hardware tests
```

## Architecture decisions

1. **Zig native, not Rust/C++.** Zig cross-compiles all targets from a single
   host with no per-platform toolchain. N-API symbols are undefined until load
   (`-fallow-shlib-undefined`), so the addon never links libnode.

2. **Raw N-API translate-c, not zig-napi.** The zig-napi wrapper lacked
   `napi_wrap`/`define_class`/threadsafe-functions/async-work/promises/buffers
   and discarded `this`. We `translateC` `node-api-headers` directly and keep
   ergonomic helpers in `napi.zig`. This also drops a dependency (the project
   favors a lean dependency tree).

3. **Threading model.** Reads run on a dedicated OS thread and reach the JS
   callback via a **threadsafe function**; a self-pipe unblocks the poll on
   close. `write`/`drain` use `napi_create_async_work` (libuv threadpool) and
   resolve a Promise — this is the sanctioned N-API offload path, not a real
   libuv dependency (nothing is linked/shipped).

4. **Config seam carries full line settings.** `NativeSerialPort.open(path,
config, cb)` where `config: NativeOpenOptions` = `{ baudRate, dataBits?,
stopBits?, parity?, rtscts?, xon?, xoff? }`. `baudRate === 0` is a sentinel
   that skips `configureSerialPort` (for PTYs). Handshake maps to the serial
   lib's single field: `rtscts` → hardware, else `xon||xoff` → software, else
   none. Do not narrow this back to baud-only — the earlier bug was the
   interface promising config the implementation dropped.

5. **Windows is a scoped follow-up.** It cross-compiles and loads (its import
   library is generated from `node_api.def` via `zig dlltool`), but native
   serial IO and port enumeration are not implemented — the class throws. POSIX
   (macOS/Linux) is complete.

6. **Port enumeration by `/dev` scan.** Avoids IOKit/SetupAPI framework linking,
   keeping cross-compilation clean. `serial`'s own iterators are not used (its
   Darwin iterator is broken on 0.16).

7. **Mock is a standalone `ISerialPort`, not a native seam.** `MockSerialPort`
   replaces `SerialPort` wholesale for tests; it does not ride the native
   binding. There is no `_nativeImpl` injection param (removed as dead code).

8. **Native binding loaded lazily, once.** `native.ts#getNative()` memoizes a
   single dynamic `import("../index.js")`, unwraps the CJS `.default`, and
   remaps "Cannot find native binding" to a friendly per-platform message.
   Loading is deferred so importing the barrel (for MockSerialPort/parsers)
   never touches the native binary.

## Native contract (must stay in sync across tiers)

`index.d.ts` and `src/types.ts` declare the native surface; `serial_port_posix.zig`
implements it. Any change to `open`'s config object must match the property
names read in `jsOpen`: `baudRate, dataBits, stopBits, parity, rtscts, xon, xoff`.

## Build & dev setup

Requires Zig `0.16.0` and Node `>= 18`. Bun for tests/lint.

```sh
npm install
npm run build:native      # build addon for the host -> prebuilds/
npm run build:prebuilds   # cross-compile every target (macOS/Linux/Windows)
npm run build:ts          # tsc -> dist/
npm run build             # native + ts
```

`build:native` runs `zig build --prefix . -Doptimize=ReleaseFast`; `--prefix .`
puts the output under `./prebuilds`. Debug builds: `-Doptimize=Debug`.

## Testing

Three suites on the Bun runner (Bun executes `.ts` directly — no precompile):

```sh
npm test                # unit: mock + parsers (src/**/*.test.ts), hermetic
npm run test:integration  # native addon over a socat PTY pair + config via stty
npm run test:hardware     # real device, opt-in (see below)
npm run typecheck         # tsc --noEmit (source)
npm run typecheck:test    # tsc -p tsconfig.test.json (source + tests)
```

- Integration needs `socat` and a host native build; it self-skips otherwise.
- **Hardware suite is opt-in** and gated on `SERIAL_TEST_PORT`; it never runs in
  CI or by accident:
  ```sh
  SERIAL_TEST_PORT=/dev/cu.usbmodem1101 npm run test:hardware
  ```
  It exercises the `arduino/test-device/` firmware protocol (PING→PONG, ID,
  ECHO, LINES, BINARY) through the public `SerialPort`.

## Release process

Tag-driven. See `RELEASING.md`.

```sh
npm version patch|minor|major
```

- `preversion` gate: `lint && typecheck && test` (unit).
- `npm version` bumps `package.json`, commits, tags `vX.Y.Z`.
- `postversion`: `git push --follow-tags`.
- The tag triggers the `publish` CI job: it waits for `test` + `prebuilds`,
  verifies the tag matches `package.json` and that all five prebuilds exist,
  then `npm publish --provenance --access public`.

One-time: `NPM_TOKEN` repo secret; the GitHub repo must be public and match the
`repository` field (npm provenance requires both).

## CI (`.github/workflows/ci.yml`)

- `test` — Node + Bun + Zig; typecheck, unit, integration (installs socat).
- `prebuilds` — one runner cross-compiles all targets, uploads the artifact.
- `publish` — tag-gated; downloads prebuilds, verifies, publishes.

## Conventions

- Biome formats with **tabs**; run `npm run lint:fix` before committing. The
  `preversion` gate runs `lint` and fails on Biome errors (warnings are OK).
- Commit/push only when asked.
- Keep the `NativeOpenOptions` property names identical across `types.ts`,
  `SerialPort.ts`, and `serial_port_posix.zig`.
- Examples are `.ts` run via bun/tsx; wrap logic in `async main()` (top-level
  await is illegal under the CJS output tsx produces).

## Gotchas

- Zig 0.16 `std.posix` dropped `write`/`close`/`pipe` — the posix impl declares
  its own `extern "c"` for those (and `read`/`poll`/`tcdrain`).
- `tsc` disallows top-level `await` and `import.meta` in CommonJS output; use
  `__dirname`/`main()` in TS that must pass `typecheck:test`.
- `@types/bun` + `@types/node` skew is handled by `skipLibCheck: true`.

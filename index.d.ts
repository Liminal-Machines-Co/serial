// Type declarations for the native addon loaded via index.js (node-gyp-build).
// The implementation lives in the Zig sources under src/napi/ and is compiled
// to prebuilds/<platform>-<arch>/serial.node.

import type { INativeSerialPortClass, PortInfo } from "./src/types.js";

export declare const NativeSerialPort: INativeSerialPortClass;
export declare function listPorts(): PortInfo[];

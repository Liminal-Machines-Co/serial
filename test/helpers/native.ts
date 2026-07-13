import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { INativeSerialPortClass, PortInfo } from "../../src/types.js";

export interface NativeModule {
	NativeSerialPort: INativeSerialPortClass;
	listPorts(): PortInfo[];
}

// __dirname works in both Bun (injected) and tsc's CommonJS output.
const require = createRequire(__filename);
const root = resolve(__dirname, "..", "..");

/**
 * The raw native addon, loaded directly (not through the SerialPort wrapper) so
 * integration tests can exercise the binding contract. Null when no prebuilt
 * binary is available — callers should skip.
 */
export const native: NativeModule | null = (() => {
	try {
		return require("node-gyp-build")(root) as NativeModule;
	} catch {
		return null;
	}
})();

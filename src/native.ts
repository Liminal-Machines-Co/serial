type NativeModule = typeof import("../index.js");

let nativePromise: Promise<NativeModule> | null = null;

async function loadNativeModule(): Promise<NativeModule> {
	try {
		// index.js is a CommonJS node-gyp-build loader, so under ESM interop the
		// addon lands on `.default` (its named exports aren't statically visible
		// through the dynamic require). Unwrap it so callers see NativeSerialPort.
		const mod = (await import("../index.js")) as NativeModule & {
			default?: NativeModule;
		};
		return mod.default ?? mod;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("Cannot find native binding")) {
			throw new Error(
				`@liminal-machines-co/serial: No pre-built binary for ${process.platform}-${process.arch}. ` +
					`See https://github.com/Liminal-Machines-Co/serial/issues for help.`,
				{ cause: err },
			);
		}
		throw err;
	}
}

// Memoized so the native binding is loaded once and shared across every
// SerialPort instance and the static list() call.
export function getNative(): Promise<NativeModule> {
	if (!nativePromise) {
		nativePromise = loadNativeModule();
	}
	return nativePromise;
}

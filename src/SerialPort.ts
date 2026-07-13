import { Readable } from "node:stream";
import { validateOptions } from "./options.js";
import type {
	INativeSerialPort,
	INativeSerialPortClass,
	ISerialPort,
	PortInfo,
	SerialPortOptions,
} from "./types.js";

type NativeModule = typeof import("../index.js");

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
				`tiny-serial: No pre-built binary for ${process.platform}-${process.arch}. ` +
					`See https://github.com/max-hans/tiny-serial/issues for help.`,
				{ cause: err },
			);
		}
		throw err;
	}
}

export class SerialPort extends Readable implements ISerialPort {
	public readonly path: string;
	public isOpen: boolean;
	private _options: SerialPortOptions;
	private _native: INativeSerialPort | null;
	private _nativeImpl: INativeSerialPortClass | null;
	private _nativePromise: Promise<INativeSerialPortClass> | null;

	constructor(
		options: SerialPortOptions,
		_nativeImpl?: INativeSerialPortClass,
	) {
		super();
		validateOptions(options);
		this.path = options.path;
		this.isOpen = false;
		this._options = options;
		this._native = null;
		this._nativeImpl = _nativeImpl ?? null;
		// Start loading native eagerly so missing-binary errors surface at construction
		// time rather than being deferred until open() is awaited.
		this._nativePromise = _nativeImpl
			? null
			: loadNativeModule().then(
					(m) => m.NativeSerialPort as unknown as INativeSerialPortClass,
				);
	}

	_read(_size: number): void {}

	_destroy(err: Error | null, callback: (err: Error | null) => void): void {
		if (this.isOpen) {
			this.close()
				.then(() => callback(err))
				.catch(() => callback(err));
		} else {
			callback(err);
		}
	}

	async open(): Promise<void> {
		if (this.isOpen) throw new Error("Port is already open");
		const NativeClass = this._nativeImpl ?? (await this._nativePromise!);
		const native = new NativeClass();
		native.open(
			this._options.path,
			this._options.baudRate,
			(err: Error | null, data: Buffer) => {
				if (err) {
					this.emit("error", err);
				} else {
					this.push(data);
				}
			},
		);
		this._native = native;
		this.isOpen = true;
		this.emit("open");
	}

	async close(): Promise<void> {
		if (!this._native) return;
		this._native.close();
		this._native = null;
		this.isOpen = false;
		this.emit("close");
	}

	async write(chunk: Buffer | string): Promise<void> {
		if (!this._native) throw new Error("Port is not open — call open() first");
		const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		return this._native.write(buf);
	}

	async drain(): Promise<void> {
		if (!this._native) throw new Error("Port is not open — call open() first");
		return this._native.drain();
	}

	static async list(): Promise<PortInfo[]> {
		const { listPorts } = await loadNativeModule();
		return listPorts() as unknown as PortInfo[];
	}
}

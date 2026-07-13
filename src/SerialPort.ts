import { Readable } from "node:stream";
import { getNative } from "./native.js";
import { validateOptions } from "./options.js";
import type {
	INativeSerialPort,
	ISerialPort,
	NativeOpenOptions,
	PortInfo,
	SerialPortOptions,
} from "./types.js";

export class SerialPort extends Readable implements ISerialPort {
	public readonly path: string;
	public isOpen: boolean;
	private _options: SerialPortOptions;
	private _native: INativeSerialPort | null;

	constructor(options: SerialPortOptions) {
		super();
		validateOptions(options);
		this.path = options.path;
		this.isOpen = false;
		this._options = options;
		this._native = null;
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
		const { NativeSerialPort } = await getNative();
		const native = new NativeSerialPort();
		const config: NativeOpenOptions = { baudRate: this._options.baudRate };
		if (this._options.dataBits !== undefined)
			config.dataBits = this._options.dataBits;
		if (this._options.stopBits !== undefined)
			config.stopBits = this._options.stopBits;
		if (this._options.parity !== undefined)
			config.parity = this._options.parity;
		if (this._options.rtscts !== undefined)
			config.rtscts = this._options.rtscts;
		if (this._options.xon !== undefined) config.xon = this._options.xon;
		if (this._options.xoff !== undefined) config.xoff = this._options.xoff;
		native.open(
			this._options.path,
			config,
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
		const { listPorts } = await getNative();
		return listPorts() as unknown as PortInfo[];
	}
}

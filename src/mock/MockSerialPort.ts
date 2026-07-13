import { Readable } from "node:stream";
import { validateOptions } from "../options.js";
import type { ISerialPort, PinName, SerialPortOptions } from "../types.js";

type FaultType = "disconnect" | "fragmentation" | "timeout";

interface MockReply {
	trigger: Buffer;
	response: Buffer;
	delay: number;
}

export interface MockPins {
	setCTS(value: boolean): void;
	setDSR(value: boolean): void;
	setDCD(value: boolean): void;
	setDTR(value: boolean): void;
	setRTS(value: boolean): void;
	getCTS(): boolean;
	getDSR(): boolean;
	getDCD(): boolean;
	getDTR(): boolean;
	getRTS(): boolean;
}

function toBuffer(value: Buffer | string): Buffer {
	return typeof value === "string" ? Buffer.from(value) : value;
}

export class MockSerialPort extends Readable implements ISerialPort {
	public readonly path: string;
	public isOpen: boolean;
	public readonly pins: MockPins;

	private _written: Buffer[];
	private _replies: MockReply[];
	private _faults: Set<FaultType>;
	private _pinState: Record<PinName, boolean>;

	constructor(options: SerialPortOptions) {
		super();
		validateOptions(options);
		this.path = options.path;
		this.isOpen = false;
		this._written = [];
		this._replies = [];
		this._faults = new Set();
		this._pinState = {
			CTS: false,
			DTR: false,
			RTS: false,
			DCD: false,
			DSR: false,
		};
		this.pins = {
			setCTS: (value: boolean) => {
				this._pinState.CTS = value;
				this.emit("pin-change", { pin: "CTS" as PinName, value });
			},
			setDSR: (value: boolean) => {
				this._pinState.DSR = value;
				this.emit("pin-change", { pin: "DSR" as PinName, value });
			},
			setDCD: (value: boolean) => {
				this._pinState.DCD = value;
				this.emit("pin-change", { pin: "DCD" as PinName, value });
			},
			setDTR: (value: boolean) => {
				this._pinState.DTR = value;
				this.emit("pin-change", { pin: "DTR" as PinName, value });
			},
			setRTS: (value: boolean) => {
				this._pinState.RTS = value;
				this.emit("pin-change", { pin: "RTS" as PinName, value });
			},
			getCTS: () => this._pinState.CTS,
			getDSR: () => this._pinState.DSR,
			getDCD: () => this._pinState.DCD,
			getDTR: () => this._pinState.DTR,
			getRTS: () => this._pinState.RTS,
		};
	}

	_read(_size: number): void {}

	async open(): Promise<void> {
		this.isOpen = true;
		this.emit("open");
	}

	async close(): Promise<void> {
		this.isOpen = false;
		this.emit("close");
	}

	async drain(): Promise<void> {}

	async write(chunk: Buffer | string): Promise<void> {
		const buf = toBuffer(chunk);
		this._written.push(Buffer.from(buf));

		if (!this._faults.has("timeout")) {
			for (const reply of this._replies) {
				if (buf.includes(reply.trigger)) {
					setTimeout(() => this._injectData(reply.response), reply.delay);
					break;
				}
			}
		}
	}

	/**
	 * Register a trigger→response pair.
	 *
	 * Matching is partial: if data passed to `write()` *contains* `trigger`
	 * anywhere, the response fires. Only the first registered match per write
	 * call fires (earlier registrations take priority over later ones).
	 */
	mockReply(
		trigger: Buffer | string,
		response: Buffer | string,
		delay = 0,
	): this {
		this._replies.push({
			trigger: toBuffer(trigger),
			response: toBuffer(response),
			delay,
		});
		return this;
	}

	getWrittenData(): Buffer {
		return Buffer.concat(this._written);
	}

	clearWrittenData(): this {
		this._written = [];
		return this;
	}

	simulateFault(type: FaultType): this {
		if (type === "disconnect") {
			this.isOpen = false;
			this.push(null);
			this.emit("close");
		} else {
			this._faults.add(type);
		}
		return this;
	}

	clearFault(type: FaultType): this {
		this._faults.delete(type);
		return this;
	}

	_injectData(data: Buffer): void {
		if (this._faults.has("fragmentation")) {
			for (let i = 0; i < data.length; i++) {
				const byte = data.subarray(i, i + 1);
				setImmediate(() => this.push(byte));
			}
		} else {
			this.push(data);
		}
	}
}

import type { TransformOptions } from "node:stream";
import { BufferedTransform } from "./BufferedTransform.js";

export interface InterByteTimeoutParserOptions extends TransformOptions {
	interval: number;
	maxBufferSize?: number;
}

export class InterByteTimeoutParser extends BufferedTransform {
	private _timeout: ReturnType<typeof setTimeout> | null;
	private _interval: number;
	private _maxBufferSize: number;

	constructor(options: InterByteTimeoutParserOptions) {
		super(options);
		if (!options.interval || options.interval < 1) {
			throw new TypeError(
				"InterByteTimeoutParser requires an interval of at least 1ms",
			);
		}
		this._interval = options.interval;
		this._maxBufferSize = options.maxBufferSize ?? 65536;
		this._timeout = null;
	}

	protected _process(): void {
		if (this._timeout !== null) {
			clearTimeout(this._timeout);
		}
		if (this._buffer.length >= this._maxBufferSize) {
			this.push(this._buffer);
			this._buffer = Buffer.alloc(0);
			this._timeout = null;
		} else {
			this._timeout = setTimeout(() => {
				this.push(this._buffer);
				this._buffer = Buffer.alloc(0);
				this._timeout = null;
			}, this._interval);
		}
	}

	protected _onFlush(): void {
		if (this._timeout !== null) {
			clearTimeout(this._timeout);
			this._timeout = null;
		}
		super._onFlush();
	}
}

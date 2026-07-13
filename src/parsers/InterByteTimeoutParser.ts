import type { TransformOptions } from "node:stream";
import { BufferedTransform } from "./BufferedTransform.js";

export interface InterByteTimeoutParserOptions<Raw extends boolean = false>
	extends TransformOptions {
	interval: number;
	maxBufferSize?: number;
	encoding?: BufferEncoding;
	raw?: Raw;
}

export class InterByteTimeoutParser<
	Raw extends boolean = false,
> extends BufferedTransform<Raw extends true ? Buffer : string> {
	protected _raw: boolean;
	protected _encoding: BufferEncoding;
	private _timeout: ReturnType<typeof setTimeout> | null;
	private _interval: number;
	private _maxBufferSize: number;

	constructor(options: InterByteTimeoutParserOptions<Raw>) {
		const raw = options.raw ?? false;
		const encoding = options.encoding ?? "utf8";
		super(raw ? options : { ...options, encoding });
		if (!options.interval || options.interval < 1) {
			throw new TypeError(
				"InterByteTimeoutParser requires an interval of at least 1ms",
			);
		}
		this._raw = raw;
		this._encoding = encoding;
		this._interval = options.interval;
		this._maxBufferSize = options.maxBufferSize ?? 65536;
		this._timeout = null;
	}

	protected _process(): void {
		if (this._timeout !== null) {
			clearTimeout(this._timeout);
		}
		if (this._buffer.length >= this._maxBufferSize) {
			this._push(this._buffer);
			this._buffer = Buffer.alloc(0);
			this._timeout = null;
		} else {
			this._timeout = setTimeout(() => {
				this._push(this._buffer);
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

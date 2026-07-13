import type { TransformOptions } from "node:stream";
import { BufferedTransform } from "./BufferedTransform.js";

export interface ByteLengthParserOptions<Raw extends boolean = false>
	extends TransformOptions {
	length: number;
	encoding?: BufferEncoding;
	raw?: Raw;
}

export class ByteLengthParser<
	Raw extends boolean = false,
> extends BufferedTransform<Raw extends true ? Buffer : string> {
	protected _raw: boolean;
	protected _encoding: BufferEncoding;
	private _length: number;

	constructor(options: ByteLengthParserOptions<Raw>) {
		const raw = options.raw ?? false;
		const encoding = options.encoding ?? "utf8";
		super(raw ? options : { ...options, encoding });
		if (!options.length || options.length < 1) {
			throw new TypeError("ByteLengthParser requires a length of at least 1");
		}
		this._raw = raw;
		this._encoding = encoding;
		this._length = options.length;
	}

	protected _process(): void {
		const len = this._length;
		let offset = 0;
		while (offset + len <= this._buffer.length) {
			this._push(this._buffer.subarray(offset, offset + len));
			offset += len;
		}
		this._buffer =
			offset < this._buffer.length
				? this._buffer.subarray(offset)
				: Buffer.alloc(0);
	}
}

import type { TransformOptions } from "node:stream";
import { BufferedTransform } from "./BufferedTransform.js";

export interface ByteLengthParserOptions extends TransformOptions {
	length: number;
}

export class ByteLengthParser extends BufferedTransform {
	private _length: number;

	constructor(options: ByteLengthParserOptions) {
		super(options);
		if (!options.length || options.length < 1) {
			throw new TypeError("ByteLengthParser requires a length of at least 1");
		}
		this._length = options.length;
	}

	protected _process(): void {
		const len = this._length;
		let offset = 0;
		while (offset + len <= this._buffer.length) {
			this.push(this._buffer.subarray(offset, offset + len));
			offset += len;
		}
		this._buffer =
			offset < this._buffer.length
				? this._buffer.subarray(offset)
				: Buffer.alloc(0);
	}
}

import type { TransformOptions } from "node:stream";
import { BufferedTransform } from "./BufferedTransform.js";

export interface ReadlineParserOptions extends TransformOptions {
	delimiter?: string | Buffer;
	encoding?: BufferEncoding;
	includeDelimiter?: boolean;
}

export class ReadlineParser extends BufferedTransform {
	private _delimiter: Buffer;
	private _includeDelimiter: boolean;

	constructor(options: ReadlineParserOptions = {}) {
		super(options);
		const delimiter = options.delimiter ?? "\n";
		this._delimiter =
			typeof delimiter === "string"
				? Buffer.from(delimiter, (options.encoding as BufferEncoding) ?? "utf8")
				: delimiter;
		this._includeDelimiter = options.includeDelimiter ?? false;
		if (this._delimiter.length === 0) {
			throw new TypeError("ReadlineParser delimiter must not be empty");
		}
	}

	protected _process(): void {
		const delimiter = this._delimiter;
		const delimLen = delimiter.length;
		const includeDelim = this._includeDelimiter;
		let searchIndex = 0;
		let cursor = 0;

		while (true) {
			const position = this._buffer.indexOf(delimiter, searchIndex);
			if (position === -1) break;
			const end = position + (includeDelim ? delimLen : 0);
			this.push(this._buffer.subarray(cursor, end));
			cursor = position + delimLen;
			searchIndex = cursor;
		}

		this._buffer =
			cursor < this._buffer.length
				? this._buffer.subarray(cursor)
				: Buffer.alloc(0);
	}
}

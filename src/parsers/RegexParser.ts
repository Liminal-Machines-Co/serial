import type { TransformCallback, TransformOptions } from "node:stream";
import { TypedDataTransform } from "./TypedDataTransform.js";

export interface RegexParserOptions extends TransformOptions {
	regex: RegExp | string | Buffer;
	encoding?: BufferEncoding;
}

export class RegexParser extends TypedDataTransform<string> {
	private _regex: RegExp;
	private _data: string;

	constructor({ regex, ...options }: RegexParserOptions) {
		super({
			...options,
			decodeStrings: true, // Native optimization
			encoding: options.encoding ?? "utf8",
		});

		if (regex === undefined || regex === null) {
			throw new TypeError(
				'"options.regex" must be a regular expression pattern or object',
			);
		}

		// Prepare regex once in constructor
		this._regex =
			regex instanceof RegExp ? regex : new RegExp(regex.toString());
		this._data = "";
	}

	_transform(chunk: string, _encoding: string, cb: TransformCallback) {
		const data = this._data + chunk;
		const parts = data.split(this._regex);

		// Save remainder
		this._data = parts.pop() ?? "";

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			// Only push non-empty strings (Matches competitor behavior)
			if (part.length > 0) {
				this.push(part);
			}
		}

		cb();
	}

	_flush(cb: TransformCallback) {
		if (this._data.length > 0) {
			this.push(this._data);
			this._data = "";
		}
		cb();
	}
}

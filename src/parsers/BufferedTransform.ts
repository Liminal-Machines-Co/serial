import type { TransformOptions } from "node:stream";
import { TypedDataTransform } from "./TypedDataTransform.js";

export abstract class BufferedTransform<
	TChunk = string,
> extends TypedDataTransform<TChunk> {
	protected _buffer: Buffer = Buffer.alloc(0);
	protected abstract _raw: boolean;
	protected abstract _encoding: BufferEncoding;

	// biome-ignore lint/complexity/noUselessConstructor: not necessary right now, but kept for later
	constructor(options?: TransformOptions) {
		super(options);
	}

	_transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: () => void,
	): void {
		this._buffer =
			this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk]);
		this._process();
		callback();
	}

	_flush(callback: () => void): void {
		this._onFlush();
		callback();
	}

	protected abstract _process(): void;

	protected _onFlush(): void {
		if (this._buffer.length > 0) {
			this._push(this._buffer);
			this._buffer = Buffer.alloc(0);
		}
	}

	protected _push(chunk: Buffer): void {
		this.push(this._raw ? chunk : chunk.toString(this._encoding));
	}
}

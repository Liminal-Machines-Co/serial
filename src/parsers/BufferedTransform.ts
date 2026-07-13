import { Transform, type TransformOptions } from "node:stream";

export abstract class BufferedTransform extends Transform {
	protected _buffer: Buffer = Buffer.alloc(0);

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
			this.push(this._buffer);
			this._buffer = Buffer.alloc(0);
		}
	}
}

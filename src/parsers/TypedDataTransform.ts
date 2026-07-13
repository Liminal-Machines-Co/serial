/** biome-ignore-all lint/suspicious/noExplicitAny: this is necessary due to nodes typing */
import { Transform } from "node:stream";

/**
 * A Transform whose "data" event is typed as TChunk instead of Node's `any`.
 * The fallback overload's `any[]` mirrors EventEmitter's own untyped
 * catch-all signature exactly (see @types/node) — required for structural
 * compatibility with the base class, not a case of avoidable `any`.
 */
export abstract class TypedDataTransform<TChunk> extends Transform {
	override on(event: "data", listener: (chunk: TChunk) => void): this;
	override on(event: string | symbol, listener: (...args: any[]) => void): this;
	override on(
		event: string | symbol,
		listener: (...args: any[]) => void,
	): this {
		return super.on(event, listener);
	}

	override once(event: "data", listener: (chunk: TChunk) => void): this;
	override once(
		event: string | symbol,
		listener: (...args: any[]) => void,
	): this;
	override once(
		event: string | symbol,
		listener: (...args: any[]) => void,
	): this {
		return super.once(event, listener);
	}
}

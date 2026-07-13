import type { Readable } from "node:stream";

export interface ISerialPort extends Readable {
	readonly path: string;
	isOpen: boolean;
	open(): Promise<void>;
	close(): Promise<void>;
	write(chunk: Buffer | string): Promise<void>;
	drain(): Promise<void>;
}

export interface SerialPortOptions {
	path: string;
	baudRate: number;
	dataBits?: 5 | 6 | 7 | 8;
	stopBits?: 1 | 1.5 | 2;
	parity?: "none" | "odd" | "even" | "mark" | "space";
	rtscts?: boolean;
	xon?: boolean;
	xoff?: boolean;
}

export interface PortInfo {
	path: string;
	portType: string;
}

export type PinName = "CTS" | "DTR" | "RTS" | "DCD" | "DSR";

export interface INativeSerialPort {
	open(
		path: string,
		baudRate: number,
		cb: (err: Error | null, data: Buffer) => void,
	): void;
	write(data: Buffer): Promise<void>;
	drain(): Promise<void>;
	close(): void;
}

export interface INativeSerialPortClass {
	new (): INativeSerialPort;
}

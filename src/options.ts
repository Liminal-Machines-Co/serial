import type { SerialPortOptions } from "./types.js";

const VALID_DATA_BITS = [5, 6, 7, 8] as const;
const VALID_STOP_BITS = [1, 1.5, 2] as const;
const VALID_PARITY = ["none", "odd", "even", "mark", "space"] as const;

export function validateOptions(options: SerialPortOptions): void {
	if (!options.path) throw new TypeError("SerialPort requires a path");
	if (
		options.baudRate === undefined ||
		options.baudRate === null ||
		options.baudRate < 0
	)
		throw new TypeError(
			"SerialPort baudRate must be a non-negative number (0 skips baud rate configuration, e.g. for PTY devices)",
		);
	if (
		options.dataBits !== undefined &&
		!(VALID_DATA_BITS as readonly number[]).includes(options.dataBits)
	)
		throw new TypeError(
			`SerialPort dataBits must be one of: ${VALID_DATA_BITS.join(", ")}`,
		);
	if (
		options.stopBits !== undefined &&
		!(VALID_STOP_BITS as readonly number[]).includes(options.stopBits)
	)
		throw new TypeError(
			`SerialPort stopBits must be one of: ${VALID_STOP_BITS.join(", ")}`,
		);
	if (
		options.parity !== undefined &&
		!(VALID_PARITY as readonly string[]).includes(options.parity)
	)
		throw new TypeError(
			`SerialPort parity must be one of: ${VALID_PARITY.join(", ")}`,
		);
}

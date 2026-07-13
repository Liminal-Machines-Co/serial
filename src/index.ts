export { SerialPort } from "./SerialPort.js";
export { MockSerialPort } from "./mock/MockSerialPort.js";
export type { MockPins } from "./mock/MockSerialPort.js";

export { BufferedTransform } from "./parsers/BufferedTransform.js";
export { ReadlineParser } from "./parsers/ReadlineParser.js";
export type { ReadlineParserOptions } from "./parsers/ReadlineParser.js";
export { ByteLengthParser } from "./parsers/ByteLengthParser.js";
export type { ByteLengthParserOptions } from "./parsers/ByteLengthParser.js";
export { InterByteTimeoutParser } from "./parsers/InterByteTimeoutParser.js";
export type { InterByteTimeoutParserOptions } from "./parsers/InterByteTimeoutParser.js";
export { RegexParser } from "./parsers/RegexParser.js";
export type { RegexParserOptions } from "./parsers/RegexParser.js";

export { validateOptions } from "./options.js";

export type {
	ISerialPort,
	SerialPortOptions,
	PortInfo,
	PinName,
} from "./types.js";

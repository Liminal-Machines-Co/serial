export type { MockPins } from "./mock/MockSerialPort.js";
export { MockSerialPort } from "./mock/MockSerialPort.js";
export { validateOptions } from "./options.js";

export { BufferedTransform } from "./parsers/BufferedTransform.js";
export type { ByteLengthParserOptions } from "./parsers/ByteLengthParser.js";
export { ByteLengthParser } from "./parsers/ByteLengthParser.js";
export type { InterByteTimeoutParserOptions } from "./parsers/InterByteTimeoutParser.js";
export { InterByteTimeoutParser } from "./parsers/InterByteTimeoutParser.js";
export type { ReadlineParserOptions } from "./parsers/ReadlineParser.js";
export { ReadlineParser } from "./parsers/ReadlineParser.js";
export type { RegexParserOptions } from "./parsers/RegexParser.js";
export { RegexParser } from "./parsers/RegexParser.js";
export { SerialPort } from "./SerialPort.js";

export type {
	ISerialPort,
	PinName,
	PortInfo,
	SerialPortOptions,
} from "./types.js";

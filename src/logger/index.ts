// Public face of the logger folder: contract (types.ts) + sinks.

export type { Logger, LogEntry, LogLevel } from "./types.ts";
export { ConsoleLogger } from "./console.ts";
export { MemoryLogger } from "./memory.ts";

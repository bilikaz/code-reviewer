// Logger interface + factory. Swap sinks by passing a different Logger
// instance into the Ctx; everything downstream uses the interface only.
export { ConsoleLogger } from "./console.js";
export { MemoryLogger } from "./memory.js";

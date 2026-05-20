// Logger interface + factory. Swap sinks by passing a different Logger
// instance into the Ctx; everything downstream uses the interface only.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  ts: string;
  scope?: string;
  event: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  // Raw streamed text (LLM token stream, etc). Structured sinks may ignore it.
  stream(chunk: string): void;
  // Scoped child — events from the child are tagged with the given scope.
  child(scope: string): Logger;
}

export { ConsoleLogger } from "./console.ts";
export { MemoryLogger } from "./memory.ts";

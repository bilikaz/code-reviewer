// Logger contract. Swap sinks by passing a different Logger instance into
// the Ctx; everything downstream uses the interface only.

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

// Scope-join format for child(). One definition so every sink produces the
// same scope strings — tests and log readers depend on the dotted form
// (essential duplication, consolidated — see docs/conventions/consolidation.md).
export function joinScope(parent: string | undefined, child: string): string {
  return parent ? `${parent}.${child}` : child;
}

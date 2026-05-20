// In-memory sink. Records every event for test assertions. `stream` chunks
// are concatenated into a single field per scope.

import type { Logger, LogEntry } from "./index.ts";

export class MemoryLogger implements Logger {
  readonly entries: LogEntry[];
  private streamBuffer: string;

  constructor(
    private readonly scope?: string,
    sharedEntries?: LogEntry[],
    sharedStreamRef?: { value: string },
  ) {
    this.entries = sharedEntries ?? [];
    this._streamRef = sharedStreamRef ?? { value: "" };
    this.streamBuffer = "";
  }

  private readonly _streamRef: { value: string };

  private record(level: LogEntry["level"], event: string, data?: Record<string, unknown>): void {
    this.entries.push({
      level,
      ts: new Date().toISOString(),
      scope: this.scope,
      event,
      ...(data ? { data } : {}),
    });
  }

  debug(event: string, data?: Record<string, unknown>): void { this.record("debug", event, data); }
  info(event: string, data?: Record<string, unknown>): void { this.record("info", event, data); }
  warn(event: string, data?: Record<string, unknown>): void { this.record("warn", event, data); }
  error(event: string, data?: Record<string, unknown>): void { this.record("error", event, data); }

  stream(chunk: string): void {
    this._streamRef.value += chunk;
  }

  get streamedText(): string {
    return this._streamRef.value;
  }

  child(scope: string): Logger {
    const next = this.scope ? `${this.scope}.${scope}` : scope;
    return new MemoryLogger(next, this.entries, this._streamRef);
  }
}

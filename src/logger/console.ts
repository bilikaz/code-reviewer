// Default sink: pretty indented output to stderr. Each event on its own
// line, structured `data` rendered as indented JSON below it.

import type { Logger, LogLevel } from "./index.ts";

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: "DBG",
  info:  "INF",
  warn:  "WRN",
  error: "ERR",
};

function render(level: LogLevel, scope: string | undefined, event: string, data?: Record<string, unknown>): string {
  const tag = LEVEL_TAG[level];
  const prefix = scope ? `[${tag} ${scope}]` : `[${tag}]`;
  if (!data || Object.keys(data).length === 0) {
    return `${prefix} ${event}\n`;
  }
  const body = JSON.stringify(data, null, 2)
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
  return `${prefix} ${event}\n${body}\n`;
}

export class ConsoleLogger implements Logger {
  constructor(private readonly scope?: string) {}

  debug(event: string, data?: Record<string, unknown>): void {
    process.stderr.write(render("debug", this.scope, event, data));
  }
  info(event: string, data?: Record<string, unknown>): void {
    process.stderr.write(render("info", this.scope, event, data));
  }
  warn(event: string, data?: Record<string, unknown>): void {
    process.stderr.write(render("warn", this.scope, event, data));
  }
  error(event: string, data?: Record<string, unknown>): void {
    process.stderr.write(render("error", this.scope, event, data));
  }
  stream(chunk: string): void {
    process.stderr.write(chunk);
  }
  child(scope: string): Logger {
    return new ConsoleLogger(this.scope ? `${this.scope}.${scope}` : scope);
  }
}

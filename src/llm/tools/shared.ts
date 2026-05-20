// Shared types + helpers for LLM tools.

import type { ToolSchema } from "../client.ts";

export interface ToolResult {
  ok: boolean;
  output: string; // What we send back to the LLM. Limited size — see CAP.
}

// Each tool implements this: exposes its own schema and an execute method.
// Dispatcher in index.ts collects them and routes by schema.function.name.
export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export const OUTPUT_CAP = 64 * 1024; // 64 KB per tool result is plenty; truncate beyond.

export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}

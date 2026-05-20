// LLM tool dispatcher. Each tool exposes a uniform { schema, execute } shape;
// this file just collects them and routes a tool_call to the right one by name.
//
// Error messages go straight back to the model in the tool-response message,
// so they spell out what went wrong, what we received, and what to do next.
// Smaller / weaker models recover well from explicit feedback; terse
// "error: X" messages leave them looping. Each tool's executor follows the
// same convention for its own missing-arg errors.
//
// Add a new tool: create tools/<name>.ts exporting `<name>Tool: Tool`, then
// add it to the TOOLS array below.

import type { ToolCall } from "../client.ts";
import { bashTool } from "./bash.ts";
import { readTool } from "./read.ts";
import type { Tool, ToolResult } from "./shared.ts";

export type { ToolResult } from "./shared.ts";

const TOOLS: Tool[] = [readTool, bashTool];

const BY_NAME = new Map(TOOLS.map((t) => [t.schema.function.name, t]));
const VALID_NAMES = TOOLS.map((t) => t.schema.function.name);

export const TOOL_SCHEMAS = TOOLS.map((t) => t.schema);

export async function execTool(call: ToolCall): Promise<ToolResult> {
  const name = call.function.name?.trim();
  if (!name) {
    return {
      ok: false,
      output:
        `tool call rejected: empty function name. ` +
        `Specify one of: ${VALID_NAMES.join(", ")}.`,
    };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch (e) {
    return {
      ok: false,
      output: [
        `tool call rejected: arguments are not valid JSON.`,
        `Tool: ${name}`,
        `Received arguments: ${call.function.arguments}`,
        `Parse error: ${(e as Error).message}`,
        `Retry with a valid JSON object matching the tool's schema.`,
      ].join("\n"),
    };
  }

  const tool = BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      output: `tool call rejected: unknown tool "${name}". Specify one of: ${VALID_NAMES.join(", ")}.`,
    };
  }
  return tool.execute(args);
}

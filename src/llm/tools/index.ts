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

import { errorMessage } from "../../lib/errors.ts";
import type { ToolCall } from "../types.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { readTool } from "./read.ts";
import { tailTool } from "./tail.ts";
import type { Tool, ToolResult } from "./types.ts";

export type { ToolResult } from "./types.ts";

// Read-only navigation only — no shell. A `Bash` tool was removed deliberately:
// `bash -lc` (and even `git -c core.pager=…`) is arbitrary command execution,
// and the review input is untrusted PR content while the container holds live
// VCS + LLM credentials. These tools take structured args and never spawn a
// shell, so the same input is inert data. Keep it that way.
const TOOLS: Tool[] = [readTool, grepTool, tailTool, lsTool, globTool];

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
        `Parse error: ${errorMessage(e)}`,
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

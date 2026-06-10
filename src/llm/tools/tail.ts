// Tail tool — the LAST lines of a file, like `tail -n`.
//
// Read shows the start of a file; Tail shows the end. Useful when a file is
// longer than Read's window and the relevant code is near the bottom.

import { readFile } from "node:fs/promises";

import { errorMessage } from "../../lib/errors.ts";
import { cap, type Tool } from "./types.ts";

const DEFAULT_LINES = 100;
const MAX_LINES = 1000;

export const tailTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Tail",
      description:
        "Read the last lines of a file, like `tail -n`. Returns the lines prefixed " +
        "with their line numbers. Defaults to the last 100 lines; pass `lines` for more or fewer.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Path to the file, relative to the working directory." },
          lines: { type: "number", description: "Optional. How many trailing lines to return. Defaults to 100." },
        },
        required: ["path"],
      },
    },
  },

  async execute(args) {
    const path = String(args.path ?? "");
    if (!path) {
      return {
        ok: false,
        output:
          `Tail call rejected: missing required \`path\` argument. ` +
          `Got: ${JSON.stringify(args)}. ` +
          `Example: {"path": "src/foo.ts"}`,
      };
    }
    let n = typeof args.lines === "number" && Number.isFinite(args.lines) ? Math.floor(args.lines) : DEFAULT_LINES;
    if (n <= 0) n = DEFAULT_LINES;
    if (n > MAX_LINES) n = MAX_LINES;
    try {
      const content = await readFile(path, "utf-8");
      const all = content.split(/\r?\n/);
      const total = all.length;
      const start = Math.max(0, total - n); // 0-based index of first shown line
      const visible = all.slice(start);
      const width = String(total).length;
      const numbered = visible
        .map((l, i) => `${String(start + i + 1).padStart(width, " ")}: ${l}`)
        .join("\n");
      const header = `# ${path} (lines ${start + 1}-${total} of ${total})`;
      return { ok: true, output: cap(`${header}\n${numbered}`) };
    } catch (e) {
      return {
        ok: false,
        output:
          `error reading ${path}: ${errorMessage(e)}. ` +
          `Check the path (relative to the working directory); use Ls or Glob if unsure.`,
      };
    }
  },
};

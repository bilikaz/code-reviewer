// Read tool — fetch a file's content from the working directory.
//
// Returns the first MAX_LINES lines numbered (1-based), plus a header with
// the visible range and total count. For longer files, appends a footer
// with a ready-to-copy `sed` command for the next chunk. Smaller models
// loop on big files when they can't see where to ask next.

import { readFile } from "node:fs/promises";

import { errorMessage } from "../../lib/errors.ts";
import { cap, type Tool } from "./types.ts";

const MAX_LINES = 300;

export const readTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Read",
      description:
        "Read a file from the working directory. Returns up to the first 300 lines, " +
        "each prefixed with its line number, plus a header showing the visible range " +
        "and total line count. For files longer than 300 lines, use Bash to fetch " +
        "the rest with `sed -n 'START,ENDp' path`, `tail -n N path`, or " +
        "`grep -n 'pattern' path`. The footer of every Read result includes a " +
        "ready-to-copy sed command for the next chunk. Path is relative to the " +
        "working directory.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Path to the file, relative to the working directory." },
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
          `Read call rejected: missing required \`path\` argument. ` +
          `Got: ${JSON.stringify(args)}. ` +
          `Example: {"path": "src/foo.ts"}`,
      };
    }
    try {
      const content = await readFile(path, "utf-8");
      return { ok: true, output: cap(formatRead(path, content)) };
    } catch (e) {
      return {
        ok: false,
        output:
          `error reading ${path}: ${errorMessage(e)}. ` +
          `Check the path (relative to the working directory) and try Bash ls/find if unsure.`,
      };
    }
  },
};

function formatRead(path: string, content: string): string {
  const lines = content.split(/\r?\n/);
  const total = lines.length;
  const visible = lines.slice(0, MAX_LINES);
  const width = String(visible.length).length;
  const numbered = visible.map((l, i) => `${String(i + 1).padStart(width, " ")}: ${l}`).join("\n");
  const header = `# ${path} (lines 1-${visible.length} of ${total})`;
  if (total <= MAX_LINES) return `${header}\n${numbered}`;
  const nextStart = MAX_LINES + 1;
  const nextEnd = Math.min(total, MAX_LINES * 2);
  return [
    header,
    numbered,
    ``,
    `[... ${total - MAX_LINES} more lines]`,
    `# Next chunk:  Bash {"command": "sed -n '${nextStart},${nextEnd}p' ${path}"}`,
  ].join("\n");
}

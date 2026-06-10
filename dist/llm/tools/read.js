// Read tool — fetch a range of a file's lines from the working directory.
//
// Returns `lines` lines starting at `start_line` (1-based; defaults to the
// first 300 from line 1), each prefixed with its line number, plus a header
// showing the visible range and the file's total line count. When more lines
// remain below, the footer spells out the exact next Read call — so paging a
// long file is just repeated Reads with a higher start_line, no shell needed.
import { readFile } from "node:fs/promises";
import { errorMessage } from "../../lib/errors.js";
import { cap } from "./types.js";
const DEFAULT_LINES = 300;
const MAX_LINES = 2000;
export const readTool = {
    schema: {
        type: "function",
        function: {
            name: "Read",
            description: "Read lines from a file in the working directory. By default returns the " +
                "first 300 lines; pass `start_line` to begin elsewhere and `lines` to choose " +
                "how many. Each line is prefixed with its line number, and the header shows " +
                "the visible range and the file's total line count. To read further down, " +
                "call Read again with a higher `start_line` (the footer shows the next call).",
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    path: { type: "string", description: "Path to the file, relative to the working directory." },
                    start_line: { type: "number", description: "Optional. 1-based line to start from. Defaults to 1." },
                    lines: { type: "number", description: "Optional. How many lines to return. Defaults to 300." },
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
                output: `Read call rejected: missing required \`path\` argument. ` +
                    `Got: ${JSON.stringify(args)}. ` +
                    `Example: {"path": "src/foo.ts"}`,
            };
        }
        let start = typeof args.start_line === "number" && Number.isFinite(args.start_line) ? Math.floor(args.start_line) : 1;
        if (start < 1)
            start = 1;
        let count = typeof args.lines === "number" && Number.isFinite(args.lines) ? Math.floor(args.lines) : DEFAULT_LINES;
        if (count <= 0)
            count = DEFAULT_LINES;
        if (count > MAX_LINES)
            count = MAX_LINES;
        try {
            const content = await readFile(path, "utf-8");
            return { ok: true, output: cap(formatRead(path, content, start, count)) };
        }
        catch (e) {
            return {
                ok: false,
                output: `error reading ${path}: ${errorMessage(e)}. ` +
                    `Check the path (relative to the working directory); use Ls or Glob if unsure.`,
            };
        }
    },
};
function formatRead(path, content, start, count) {
    const all = content.split(/\r?\n/);
    const total = all.length;
    if (start > total) {
        return `# ${path} (${total} lines) — start_line ${start} is past the end of the file.`;
    }
    const from = start - 1; // 0-based slice index
    const visible = all.slice(from, from + count);
    const end = from + visible.length; // 1-based last line shown
    const width = String(end).length;
    const numbered = visible
        .map((l, i) => `${String(start + i).padStart(width, " ")}: ${l}`)
        .join("\n");
    const header = `# ${path} (lines ${start}-${end} of ${total})`;
    if (end >= total)
        return `${header}\n${numbered}`;
    return [
        header,
        numbered,
        ``,
        `[... ${total - end} more lines]`,
        `# Continue with Read {"path": "${path}", "start_line": ${end + 1}}`,
    ].join("\n");
}

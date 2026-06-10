// Grep tool — search file contents for a regex under a path, like `grep -rn`.
//
// Two mandatory params: `pattern` (regex) and `path` (where to search). We
// never go through a shell: runGrep spawns the `grep` binary with an ARGV
// ARRAY, so the model-supplied pattern/path are literal arguments, never
// tokenized by a shell — `|`, `;`, `$()`, quotes are inert data, not
// operators (this is exactly why there is no Bash tool: a shell would turn
// them into commands). NEVER rebuild this with `exec`, a command string, or
// `{ shell: true }` — that reintroduces arbitrary command execution.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { cap, type Tool } from "./types.ts";

const TIMEOUT_MS = 30_000;

export const grepTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Grep",
      description:
        "Search file contents for a pattern (regular expression), like `grep -rn`. " +
        "Returns matching lines as `path:line:text` with a couple of lines of " +
        "surrounding context. You must say where to search via `path` — scope it to " +
        "the folder you expect the match in (e.g. `src`), or point at a specific " +
        "file or dependency directory.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string", description: "Text or regular expression to search for." },
          path: { type: "string", description: "File or directory to search in, e.g. `src` or `src/foo.ts`." },
        },
        required: ["pattern", "path"],
      },
    },
  },

  async execute(args) {
    const pattern = String(args.pattern ?? "");
    const path = String(args.path ?? "");
    if (!pattern || !path) {
      return {
        ok: false,
        output:
          `Grep call rejected: both \`pattern\` and \`path\` are required. ` +
          `Got: ${JSON.stringify(args)}. ` +
          `Example: {"pattern": "myFunction", "path": "src"}`,
      };
    }
    if (!existsSync(path)) {
      return {
        ok: false,
        output:
          `Grep call rejected: path ${JSON.stringify(path)} does not exist. ` +
          `Pass a file or directory that exists (use Ls or Glob to locate it).`,
      };
    }
    const r = await runGrep(pattern, path);
    if (r.timedOut) return { ok: false, output: `Grep timed out searching ${path}.` };
    if (r.code === 0) return { ok: true, output: cap(r.output) };
    if (r.code === 1) return { ok: true, output: `No matches for ${JSON.stringify(pattern)} in ${path}.` };
    return { ok: false, output: `Grep failed (exit ${r.code}): ${r.output.trim() || "unknown error"}` };
  },
};

interface GrepResult {
  code: number | null;
  output: string; // combined stdout + stderr
  timedOut: boolean;
}

// Run `grep` with an argv array (no shell — see the file header) and collect
// its output, killing it on a timeout. grep exit codes: 0 = matches, 1 = no
// matches, 2 = error; the caller translates them.
function runGrep(pattern: string, path: string): Promise<GrepResult> {
  // `-e` marks the pattern so one starting with `-` is data, not a flag;
  // -r recurses, -n adds line numbers, -C 2 gives a little context.
  const args = ["-rn", "-C", "2", "-e", pattern, path];
  return new Promise((resolve) => {
    const proc = spawn("grep", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);
    proc.stdout.on("data", (b: Buffer) => { out += b.toString("utf-8"); });
    proc.stderr.on("data", (b: Buffer) => { out += b.toString("utf-8"); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: out, timedOut });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, output: `error spawning grep: ${e.message}`, timedOut });
    });
  });
}

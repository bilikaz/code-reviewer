// Bash tool — run a shell command in the working directory.
//
// The container is throwaway and isolated, so this tool doesn't sandbox
// paths or restrict commands — the LLM has whatever the container ships
// with (git, grep, find, rg if installed, etc.).

import { spawn } from "node:child_process";

import { cap, type Tool, type ToolResult } from "./types.ts";

export const bashTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Bash",
      description:
        "Run a shell command in the working directory. Returns combined stdout+stderr plus the exit code. Use for `git log`, `git blame`, `git show`, `grep -rn`, `find`, listing dirs, etc. The container is throwaway — no path restrictions, but state does not persist between calls.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "The shell command to run. Executed via `bash -lc`." },
          timeout_seconds: { type: "number", description: "Optional. Defaults to 60." },
        },
        required: ["command"],
      },
    },
  },

  async execute(args) {
    const command = String(args.command ?? "");
    const timeoutMs = typeof args.timeout_seconds === "number" ? args.timeout_seconds * 1000 : 60_000;
    if (!command) {
      return {
        ok: false,
        output:
          `Bash call rejected: missing required \`command\` argument. ` +
          `Got: ${JSON.stringify(args)}. ` +
          `Example: {"command": "ls -la"}`,
      };
    }
    return runBash(command, timeoutMs);
  },
};

function runBash(command: string, timeoutMs: number): Promise<ToolResult> {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-lc", command], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (b: Buffer) => { out += b.toString("utf-8"); });
    proc.stderr.on("data", (b: Buffer) => { out += b.toString("utf-8"); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const suffix = timedOut
        ? `\n[exit: killed after ${timeoutMs}ms timeout]`
        : `\n[exit: ${code}]`;
      resolve({ ok: !timedOut && code === 0, output: cap(out) + suffix });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `error spawning bash: ${e.message}` });
    });
  });
}

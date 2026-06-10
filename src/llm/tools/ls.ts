// Ls tool — list a directory, like `ls`.
//
// Pure filesystem read, no subprocess. Directories get a trailing `/`.

import { readdir } from "node:fs/promises";

import { errorMessage } from "../../lib/errors.ts";
import { cap, type Tool } from "./types.ts";

export const lsTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Ls",
      description:
        "List the entries of a directory, like `ls`. Directories are shown with a " +
        "trailing `/`. Defaults to the working directory.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Optional. Directory to list, relative to the working directory. Defaults to `.`." },
        },
        required: [],
      },
    },
  },

  async execute(args) {
    const path = args.path != null && String(args.path) ? String(args.path) : ".";
    try {
      const entries = await readdir(path, { withFileTypes: true });
      if (entries.length === 0) return { ok: true, output: `# ${path} (empty)` };
      const names = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => a.localeCompare(b));
      return { ok: true, output: cap(`# ${path} (${entries.length} entries)\n${names.join("\n")}`) };
    } catch (e) {
      return {
        ok: false,
        output: `error listing ${path}: ${errorMessage(e)}. Check the path (relative to the working directory).`,
      };
    }
  },
};

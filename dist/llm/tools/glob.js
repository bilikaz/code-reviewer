// Glob tool — find files by path pattern, like a shell glob / `find -name`.
//
// Pure filesystem walk via node:fs/promises glob, no subprocess. Noise
// directories are pruned and results are capped so a broad pattern can't
// flood the model's context.
import { glob } from "node:fs/promises";
import { errorMessage } from "../../lib/errors.js";
import { cap } from "./types.js";
const MAX_RESULTS = 500;
const EXCLUDE = ["node_modules", ".git", "dist"];
export const globTool = {
    schema: {
        type: "function",
        function: {
            name: "Glob",
            description: "Find files whose path matches a glob pattern, e.g. `src/**/*.ts` or " +
                "`**/*.test.js`. Returns matching file paths.",
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    pattern: { type: "string", description: "Glob pattern to match file paths against, e.g. `src/**/*.ts`." },
                },
                required: ["pattern"],
            },
        },
    },
    async execute(args) {
        const pattern = String(args.pattern ?? "");
        if (!pattern) {
            return {
                ok: false,
                output: `Glob call rejected: missing required \`pattern\` argument. ` +
                    `Got: ${JSON.stringify(args)}. ` +
                    `Example: {"pattern": "src/**/*.ts"}`,
            };
        }
        try {
            const matches = [];
            const isExcluded = (p) => p.split(/[\\/]/).some((seg) => EXCLUDE.includes(seg));
            for await (const m of glob(pattern, { exclude: isExcluded })) {
                matches.push(m);
                if (matches.length >= MAX_RESULTS)
                    break;
            }
            if (matches.length === 0)
                return { ok: true, output: `No files match ${JSON.stringify(pattern)}.` };
            matches.sort((a, b) => a.localeCompare(b));
            const note = matches.length >= MAX_RESULTS ? `\n[... truncated at ${MAX_RESULTS} matches]` : "";
            return { ok: true, output: cap(`# ${matches.length} match(es) for ${pattern}\n${matches.join("\n")}${note}`) };
        }
        catch (e) {
            return { ok: false, output: `error globbing ${pattern}: ${errorMessage(e)}.` };
        }
    },
};

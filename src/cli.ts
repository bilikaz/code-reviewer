#!/usr/bin/env node
// Reviewer CLI.
//
// Subcommands:
//   run         — fetch → reconcile (if unresolved bot threads) → review → summarize
//   fetch       — fetch only
//   reconcile   — fetch + reconcile
//   review      — fetch + review (skips reconcile)
//   summarize   — fetch + summarize (skips review and reconcile; existing
//                 unresolved bot threads count as unaddressed)
//
// Flags:
//   --pr <url>          required (or set PR_URL env). A real PR URL (github/
//                       gitlab/bitbucket), `mock://<scenario>` for tests, or
//                       `local://<base>` to review the current checkout's
//                       branch against <base> (default main) with no VCS —
//                       findings print to the console (comments + verdict)
//                       instead of posting. Must run inside a container.
//   --llm-url <url>     overrides LLM_URL
//   --llm-key <key>     overrides LLM_KEY
//   --llm-model <name>  overrides LLM_MODEL (otherwise auto-detected)

import { buildCtx, type CliOverrides, type Ctx } from "./ctx.ts";
import { runFetch } from "./stages/fetch/index.ts";
import { runReconcile } from "./stages/reconcile/index.ts";
import { runReview } from "./stages/review/index.ts";
import { runSummarize } from "./stages/summarize/index.ts";
import type { StageState } from "./stages/types.ts";

// ---- Argv parser --------------------------------------------------------

interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
}

const FLAG_ALIASES: Record<string, string> = {
  "--pr": "pr",
  "--llm-url": "llmUrl",
  "--llm-key": "llmKey",
  "--llm-model": "llmModel",
};

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[2];
  if (!command || command === "--help" || command === "-h") usageAndExit();
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i]!;
    const key = FLAG_ALIASES[a];
    if (!key) die(`unknown flag: ${a}`);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) die(`flag ${a} requires a value`);
    flags[key] = val;
    i++;
  }
  return { command, flags };
}

function usageAndExit(): never {
  process.stderr.write(
    "usage: reviewer <run|fetch|reconcile|review|summarize> --pr <url|local://[base]> [--llm-url <u>] [--llm-key <k>] [--llm-model <m>]\n",
  );
  process.exit(2);
}

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

function buildOverrides(flags: Record<string, string>): CliOverrides {
  const prUrl = flags.pr ?? process.env.PR_URL ?? "";
  if (!prUrl) die("missing --pr (or PR_URL env)");
  return {
    prUrl,
    llmUrl:   flags.llmUrl,
    llmKey:   flags.llmKey,
    llmModel: flags.llmModel,
  };
}

// ---- Pipeline orchestration --------------------------------------------

function hasUnresolvedBotThreads(state: StageState): boolean {
  return state.comments.some(
    (c) => c.by === "bot" && c.inline && !c.resolved && !c.parentId,
  );
}

async function runCommand(command: string, ctx: Ctx): Promise<StageState> {
  switch (command) {
    case "run": {
      let state = await runFetch(ctx);
      if (hasUnresolvedBotThreads(state)) {
        ctx.logger.info("pipeline.followup", { reason: "unresolved_bot_threads" });
        state = await runReconcile(ctx, state);
      } else {
        ctx.logger.info("pipeline.initial");
      }
      state = await runReview(ctx, state);
      return runSummarize(ctx, state);
    }
    case "fetch": {
      return runFetch(ctx);
    }
    case "reconcile": {
      const state = await runFetch(ctx);
      return runReconcile(ctx, state);
    }
    case "review": {
      const state = await runFetch(ctx);
      return runReview(ctx, state);
    }
    case "summarize": {
      const state = await runFetch(ctx);
      return runSummarize(ctx, state);
    }
    default:
      die(`unknown command: ${command}`);
  }
}

// ---- Entry --------------------------------------------------------------

const { command, flags } = parseArgs(process.argv);
const ctx = await buildCtx(buildOverrides(flags));
try {
  const state = await runCommand(command, ctx);
  if (state.verdict?.fatal) process.exit(1);
} catch (e) {
  ctx.logger.error("cli.fatal", { error: (e as Error).message });
  process.exit(1);
}

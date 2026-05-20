// Shared helpers for integration tests.
//
// Tests run inside the reviewer-test Docker image with env from tests/.env
// (LLM_URL, optionally LLM_KEY / LLM_MODEL). Each test:
//   - builds a Ctx targeting a mock://<scenario> URL,
//   - drives one or more stages,
//   - asserts on what the MockVcsProvider received + on the returned
//     StageState.

import { buildCtx, type Ctx } from "../src/ctx.ts";
import { MemoryLogger } from "../src/logger/memory.ts";
import type { MockVcsProvider } from "../src/vcs/mock.ts";

export interface TestCtx {
  ctx: Ctx;
  vcs: MockVcsProvider;
  logger: MemoryLogger;
}

export interface TestCtxOpts {
  // Override the diff filter's extension allowlist. Empty (the default)
  // means "accept everything as source". Tests that need to exercise the
  // binary-bucket path (non-allowlisted text, suspicious binary) pass an
  // explicit list here.
  includeExtensions?: string[];
}

export async function buildTestCtx(scenario: string, opts: TestCtxOpts = {}): Promise<TestCtx> {
  const logger = new MemoryLogger();
  const review = opts.includeExtensions !== undefined
    ? {
        diffFilter: {
          includeExtensions: opts.includeExtensions,
          fullFileThresholdLines: 800,
          bigFileHeaderLines: 30,
          fullFileCoverageThreshold: 0.8,
          narrowContextLines: 3,
        },
      }
    : undefined;
  const ctx = await buildCtx({ prUrl: `mock://${scenario}`, logger, review });
  return { ctx, vcs: ctx.vcs as MockVcsProvider, logger };
}

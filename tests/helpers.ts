// Shared helpers for integration tests.
//
// Tests run inside the reviewer-test Docker image with env from tests/.env
// (LLM_URL, optionally LLM_KEY / LLM_MODEL). Each test:
//   - builds a Ctx targeting a mock://<scenario> URL,
//   - drives one or more stages,
//   - asserts on what the MockProvider received + on the returned
//     StageState.

import { buildCtx, REVIEW_DEFAULTS, type Ctx } from "../src/ctx.ts";
import { MemoryLogger } from "../src/logger/memory.ts";
import type { MockProvider } from "../src/providers/mock.ts";

export interface TestCtx {
  ctx: Ctx;
  provider: MockProvider;
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
    ? { diffFilter: { ...REVIEW_DEFAULTS.diffFilter, includeExtensions: opts.includeExtensions } }
    : undefined;
  const ctx = await buildCtx({ prUrl: `mock://${scenario}`, logger, review });
  return { ctx, provider: ctx.provider as MockProvider, logger };
}

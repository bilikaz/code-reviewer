// Summarize verdict logic — unit-style, no LLM, no fixture.
//
// Each test hand-builds a StageState, points runSummarize at a bare
// MockProvider, and asserts on the returned verdict + recorded side effects.

import { describe, it, expect } from "vitest";

import { REVIEW_DEFAULTS, type Config, type Ctx } from "../../src/ctx.ts";
import { MemoryLogger } from "../../src/logger/memory.ts";
import { runSummarize } from "../../src/stages/summarize/index.ts";
import { emptyRenderingContext, type StageState } from "../../src/stages/types.ts";
import { MockProvider } from "../../src/providers/mock.ts";
import type { PRComment } from "../../src/providers/types.ts";

// ---- Minimal Ctx + StageState builders ---------------------------------

function makeCtx(opts: { charLimit?: number } = {}): Ctx {
  const provider = MockProvider.empty();
  const config: Config = {
    pr: { url: "mock://summarize", provider: "mock" },
    llm: { baseUrl: "", apiKey: "", model: "", temperature: 0.2, maxOutputTokens: 8192, healRetries: 2, debug: false },
    github:    { token: "" },
    gitlab:    { token: "", baseUrl: "" },
    bitbucket: { token: "", baseUrl: "" },
    review: { ...REVIEW_DEFAULTS, summaryCommentCharLimit: opts.charLimit ?? 200 },
  };
  return { config, provider, logger: new MemoryLogger() };
}

function baseState(overrides: Partial<StageState> = {}): StageState {
  return {
    meta: {
      title: "Test PR", description: "", author: "dev",
      baseBranch: "main", headBranch: "feature",
      baseSha: "abc", headSha: "def",
      url: "mock://summarize", state: "open",
    },
    diff: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n",
    comments: [],
    context: {
      projectContext: "",
      reviewChecklist: "",
      workingDir: { cwd: process.cwd() },
      rendering: emptyRenderingContext(),
    },
    metrics: [],
    ...overrides,
  };
}

// ---- Tests --------------------------------------------------------------

describe("summarize", () => {
  it("approves when there are no findings, no decisions, and the diff has reviewable source", async () => {
    const ctx = makeCtx();
    const out = await runSummarize(ctx, baseState());

    expect(out.verdict?.verdict).toBe("approve");
    expect(out.verdict?.blockingFindingsCount).toBe(0);
    expect(out.verdict?.unaddressedThreadCount).toBe(0);
    expect(out.verdict?.fatal).toBe(false);

    const recorder = ctx.provider as MockProvider;
    expect(recorder.verdicts).toHaveLength(1);
    expect(recorder.verdicts[0]!.verdict).toBe("approve");
  });

  it("requests changes when a blocker finding is present", async () => {
    const ctx = makeCtx();
    const state = baseState({
      findings: [{
        path: "src/auth.ts",
        snippet: "const KEY = 'sk-abc'",
        body: "Hardcoded credential.",
        severity: "blocker",
      }],
    });
    const out = await runSummarize(ctx, state);

    expect(out.verdict?.verdict).toBe("reject");
    expect(out.verdict?.blockingFindingsCount).toBe(1);
    // request_changes verdict triggers fatal exit (CI red) by design.
    expect(out.verdict?.fatal).toBe(true);
  });

  it("requests changes when reconcile produced an unaddressed decision", async () => {
    const ctx = makeCtx();
    const state = baseState({
      decisions: [
        { thread_id: "t1", comment_id: "c1", addressed: false, reason: "Concern still stands." },
        { thread_id: "t2", comment_id: "c2", addressed: true,  reason: "Resolved." },
      ],
    });
    const out = await runSummarize(ctx, state);

    expect(out.verdict?.verdict).toBe("reject");
    expect(out.verdict?.unaddressedThreadCount).toBe(1);
  });

  it("requests changes when the diff has no reviewable source", async () => {
    const ctx = makeCtx();
    const state = baseState({ diff: "" }); // no `diff --git` lines at all
    const out = await runSummarize(ctx, state);

    expect(out.verdict?.verdict).toBe("reject");
    expect(out.verdict?.noReviewableSource).toBe(true);
  });

  it("falls back to comments when reconcile did not run", async () => {
    const ctx = makeCtx();
    const unresolvedBot: PRComment = {
      id: "c1",
      threadId: "t1",
      by: "bot",
      author: "reviewer-bot",
      body: "Previous finding.",
      createdAt: "2024-01-01T00:00:00Z",
      inline: { path: "src/x.ts", line: 5, side: "head" },
      resolved: false,
    };
    const state = baseState({ comments: [unresolvedBot] }); // decisions deliberately undefined
    const out = await runSummarize(ctx, state);

    expect(out.verdict?.verdict).toBe("reject");
    expect(out.verdict?.unaddressedThreadCount).toBe(1);
  });

  it("truncates summary entries that exceed summaryCommentCharLimit", async () => {
    const ctx = makeCtx({ charLimit: 50 });
    const longBody = "a".repeat(120);
    const state = baseState({
      findings: [{
        path: "src/x.ts",
        snippet: "x",
        body: longBody,
        severity: "info",
      }],
    });
    await runSummarize(ctx, state);

    const recorder = ctx.provider as MockProvider;
    const summaryArg = recorder.verdicts[0]!.summary ?? "";
    // ellipsis present → truncation happened
    expect(summaryArg).toContain("…");
    // truncated chunk should be roughly cap+1 'a's (cap=50 + …)
    const aRun = summaryArg.match(/a+/);
    expect(aRun?.[0].length).toBeLessThanOrEqual(50);
  });
});

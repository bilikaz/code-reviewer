// End-to-end reconcile tests. Each runs `fetch + reconcile` against a
// fixture scenario. The first two (deterministic paths) don't hit the LLM;
// the last three exercise the LLM's judgment on prior bot threads.

import { describe, expect, it } from "vitest";

import { runFetch } from "../../src/stages/fetch/index.ts";
import { runReconcile } from "../../src/stages/reconcile/index.ts";
import { buildTestCtx } from "../helpers.ts";

describe("reconcile", () => {
  it("auto_address_deleted: thread on a deleted file is auto-resolved (no LLM)", async () => {
    const { ctx, vcs } = await buildTestCtx("reconcile/auto_address_deleted");
    let state = await runFetch(ctx);
    state = await runReconcile(ctx, state);

    const decisions = state.decisions ?? [];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.comment_id).toBe("100");
    expect(decisions[0]!.addressed).toBe(true);
    expect(decisions[0]!.reason).toMatch(/no longer exists/i);

    expect(vcs.resolvedThreads.some((r) => r.threadId === "t100")).toBe(true);

    // No LLM call — reconcile's stage metric should be skipped.
    const m = state.metrics.find((x) => x.stage === "reconcile");
    expect(m?.skipped).toBe(true);
  });

  it("renamed_file: rename banner posted on new path + old thread resolved (no LLM)", async () => {
    const { ctx, vcs } = await buildTestCtx("reconcile/renamed_file");
    let state = await runFetch(ctx);
    state = await runReconcile(ctx, state);

    // Notice posted on the new path at line 1.
    const notice = vcs.postedInline.find((p) => p.c.path === "src/authentication.ts" && p.c.line === 1);
    expect(notice).toBeDefined();
    expect(notice!.c.body).toMatch(/File renamed:.*src\/auth\.ts.*src\/authentication\.ts/s);

    // Original thread resolved.
    expect(vcs.resolvedThreads.some((r) => r.threadId === "t200")).toBe(true);

    // No LLM judgment needed for the renamed thread.
    const m = state.metrics.find((x) => x.stage === "reconcile");
    expect(m?.skipped).toBe(true);
  });

  it("fix_applied: LLM marks thread addressed when the diff implements the fix", async () => {
    const { ctx, vcs } = await buildTestCtx("reconcile/fix_applied");
    let state = await runFetch(ctx);
    state = await runReconcile(ctx, state);

    const decision = (state.decisions ?? []).find((d) => d.comment_id === "500");
    expect(decision).toBeDefined();
    expect(decision!.addressed).toBe(true);
    expect(vcs.resolvedThreads.some((r) => r.threadId === "t500")).toBe(true);
  });

  it("user_valid_reply: LLM accepts a verifiable dev explanation as addressed", async () => {
    const { ctx, vcs } = await buildTestCtx("reconcile/user_valid_reply");
    let state = await runFetch(ctx);
    state = await runReconcile(ctx, state);

    const decision = (state.decisions ?? []).find((d) => d.comment_id === "300");
    expect(decision).toBeDefined();
    expect(decision!.addressed).toBe(true);
    expect(vcs.resolvedThreads.some((r) => r.threadId === "t300")).toBe(true);
  });

  it("user_invalid_reply: LLM rejects a bogus dev rebuttal — thread stays unaddressed", async () => {
    const { ctx, vcs } = await buildTestCtx("reconcile/user_invalid_reply");
    let state = await runFetch(ctx);
    state = await runReconcile(ctx, state);

    const decision = (state.decisions ?? []).find((d) => d.comment_id === "400");
    expect(decision).toBeDefined();
    expect(decision!.addressed).toBe(false);
    // Unaddressed → thread NOT resolved.
    expect(vcs.resolvedThreads.some((r) => r.threadId === "t400")).toBe(false);
  });
});

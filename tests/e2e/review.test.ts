// End-to-end review tests. Each runs `fetch + review` against a fixture
// scenario through the real LLM. Assertions favor structural facts the
// pipeline guarantees (file ended up in the right bucket, blocker findings
// got posted inline, etc.) over fragile text matches on LLM output.

import { describe, expect, it } from "vitest";

import { runFetch } from "../../src/stages/fetch/index.ts";
import { runReview } from "../../src/stages/review/index.ts";
import { buildTestCtx } from "../helpers.ts";

describe("review", () => {
  it("clean: produces no blocking findings", async () => {
    const { ctx, provider } = await buildTestCtx("review/clean");
    let state = await runFetch(ctx);
    state = await runReview(ctx, state);

    const blockingSeverities = new Set(ctx.config.review.verdictGuard.approveBlockingSeverities);
    const blocking = (state.findings ?? []).filter((f) => blockingSeverities.has(f.severity));
    expect(blocking).toHaveLength(0);
    expect(provider.postedInline).toHaveLength(0);
  });

  it("exposed_secret: flags blocker findings + posts them inline", async () => {
    const { ctx, provider } = await buildTestCtx("review/exposed_secret");
    let state = await runFetch(ctx);
    state = await runReview(ctx, state);

    const findings = state.findings ?? [];
    expect(findings.length).toBeGreaterThan(0);
    const blockers = findings.filter((f) => f.severity === "blocker");
    expect(blockers.length).toBeGreaterThanOrEqual(1);
    // Every blocker goes to inline post (review.ts filters by verdictGuard).
    expect(provider.postedInline.length).toBeGreaterThanOrEqual(blockers.length);
    expect(provider.postedInline.every((p) => p.c.path === "src/payments.ts")).toBe(true);
  });

  it("dangerous_shell: flags at least one warning or blocker", async () => {
    const { ctx, provider } = await buildTestCtx("review/dangerous_shell");
    let state = await runFetch(ctx);
    state = await runReview(ctx, state);

    const elevated = (state.findings ?? []).filter((f) => f.severity === "warning" || f.severity === "blocker");
    expect(elevated.length).toBeGreaterThan(0);
    expect(provider.postedInline.length).toBeGreaterThan(0);
  });

  it("non_allowlisted_text: .jsx file lands in binary_files; LLM may Read it", async () => {
    const { ctx } = await buildTestCtx("review/non_allowlisted_text", {
      includeExtensions: [".ts", ".js"],
    });
    let state = await runFetch(ctx);

    const binary = state.context.rendering.binary_files;
    expect(binary.length).toBeGreaterThan(0);
    expect(binary.some((b) => b.path.endsWith(".jsx"))).toBe(true);

    state = await runReview(ctx, state);
    // Tool-call usage isn't guaranteed (depends on the model), but the
    // findings array exists and the run completed cleanly.
    expect(state.findings).toBeDefined();
    expect(state.metrics.some((m) => m.stage === "review" && m.error === undefined)).toBe(true);
  });

  it("suspicious_binary: tiny old/new delta on a non-allowlisted file fires the warning", async () => {
    const { ctx } = await buildTestCtx("review/suspicious_binary", {
      includeExtensions: [".ts", ".js"],
    });
    const state = await runFetch(ctx);

    const binary = state.context.rendering.binary_files;
    expect(binary.length).toBeGreaterThan(0);
    const entry = binary.find((b) => b.path.endsWith(".yaml"));
    expect(entry).toBeDefined();
    expect(entry!.suspicious).toBe(true);
    // Review stage is optional here — the warning itself is fetch-stage's
    // job; the LLM behavior on top is non-deterministic.
  });
});

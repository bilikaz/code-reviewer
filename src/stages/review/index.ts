// review — runs the actual code review. Assembles the prompt with PR data,
// calls the LLM, anchors each finding's snippet to a head-side line, and
// posts inline review comments via the VCS provider.
//
// Anchor resolution: LLMs miscount line numbers but quote source faithfully,
// so the prompt asks for a verbatim snippet (plus optional context_before/
// after to disambiguate) and we do the line-number work here.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Ctx } from "../../ctx.ts";
import { callLLM, type Section } from "../../llm/call.ts";
import { hasRendering, renderRenderingContext } from "../shared.ts";
import type { ReviewFinding, StageState } from "../types.ts";

const HERE = import.meta.dirname;
const PROMPT = readFileSync(resolve(HERE, "prompt.md"), "utf-8");
const SCHEMA_TEXT = readFileSync(resolve(HERE, "schema.json"), "utf-8");
const SCHEMA = JSON.parse(SCHEMA_TEXT) as object;

const SLOT = {
  outputSchema:     "output_schema",
  projectContext:   "project_context",
  prMetadata:       "pr_metadata",
  prDiff:           "pr_diff",
  prComments:       "pr_comments",
  threadDecisions:  "thread_decisions",
  reviewChecklist:  "review_checklist",
  renderingContext: "rendering_context",
} as const;

interface ReviewPayload {
  comments: ReviewFinding[];
}

export async function runReview(ctx: Ctx, state: StageState): Promise<StageState> {
  const t0 = Date.now();
  const log = ctx.logger.child("review");

  const systemSections: Section[] = [
    { tag: "", content: PROMPT },
    { tag: SLOT.outputSchema, content: SCHEMA_TEXT },
  ];
  if (state.context.projectContext.trim()) {
    systemSections.push({ tag: SLOT.projectContext, content: state.context.projectContext });
  }
  if (state.context.reviewChecklist) {
    systemSections.push({ tag: SLOT.reviewChecklist, content: state.context.reviewChecklist });
  }
  if (hasRendering(state.context.rendering)) {
    systemSections.push({ tag: SLOT.renderingContext, content: renderRenderingContext(state.context.rendering) });
  }

  const userSections: Section[] = [
    { tag: SLOT.prMetadata, content: JSON.stringify(state.meta, null, 2) },
    { tag: SLOT.prDiff, content: state.diff },
    { tag: SLOT.prComments, content: JSON.stringify(state.comments, null, 2) },
  ];
  if (state.decisions?.length) {
    userSections.push({ tag: SLOT.threadDecisions, content: JSON.stringify(state.decisions, null, 2) });
  }

  const result = await callLLM<ReviewPayload>({
    ctx, stage: "review", systemSections, userSections, schema: SCHEMA,
  });
  const findings = result.validated.comments;

  await postFindings(ctx, findings);
  log.info("done", { findings: findings.length });

  return {
    ...state,
    findings,
    metrics: [...state.metrics, {
      stage: "review",
      durationMs: Date.now() - t0,
      tokens: { input: result.usage.promptTokens, output: result.usage.completionTokens, total: result.usage.totalTokens },
      healAttempts: result.healAttempts,
      toolCalls: result.toolCalls,
    }],
  };
}

async function postFindings(ctx: Ctx, findings: ReviewFinding[]): Promise<void> {
  const log = ctx.logger.child("review.post");
  const blocking = new Set(ctx.config.review.verdictGuard.approveBlockingSeverities);

  for (const c of findings) {
    if (!blocking.has(c.severity)) continue;
    try {
      await postFinding(ctx, log, c);
    } catch (e) {
      log.error("post.failed", { path: c.path, error: (e as Error).message });
    }
  }
}

// Anchor the finding to a head-side line and post it. If the file is gone
// we degrade to a top-level summary comment; if it exists but the snippet
// can't be uniquely located we post on line 1 with a banner explaining why.
async function postFinding(ctx: Ctx, log: ReturnType<Ctx["logger"]["child"]>, c: ReviewFinding): Promise<void> {
  if (!c.path || !existsSync(c.path)) {
    const body = wrapWithBanner(c.anchor.snippet, c.body, "anchor not located");
    log.warn("anchor.unresolved", { path: c.path, fallback: "top_level" });
    await ctx.vcs.postSummaryComment(body);
    return;
  }

  let line = findUniqueMatch(c.path, c.anchor);
  let body = c.body;
  if (line == null) {
    line = 1;
    log.warn("anchor.unresolved", { path: c.path, fallback: "line_1" });
    body = wrapWithBanner(c.anchor.snippet, c.body, "snippet not uniquely matched on head");
  }
  await ctx.vcs.postInlineComment({ path: c.path, line, body });
}

// ---- anchor resolution --------------------------------------------------

interface AnchorSpec {
  snippet: string;
  context_before?: string;
  context_after?: string;
}

function normalizeLines(text: string): string[] {
  // Strip leading whitespace per line (prompt instructs the LLM to do the
  // same on its end, so the comparison is whitespace-insensitive at the
  // line head).
  return text.split(/\r?\n/).map((l) => l.replace(/^\s+/, ""));
}

function findAllMatches(haystack: string[], needle: string[]): number[] {
  if (needle.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

// Returns the 1-based head-side line if the snippet matches exactly one place
// (using context_before/after to disambiguate), else null.
function findUniqueMatch(path: string, anchor: AnchorSpec): number | null {
  const fileLines = normalizeLines(readFileSync(path, "utf-8"));
  const snippetLines = normalizeLines(anchor.snippet).filter((l) => l !== "");
  if (snippetLines.length === 0) return null;

  const matches = findAllMatches(fileLines, snippetLines);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]! + 1;

  // Multiple matches — disambiguate with context_before/after.
  const before = anchor.context_before ? normalizeLines(anchor.context_before).filter((l) => l !== "") : [];
  const after  = anchor.context_after  ? normalizeLines(anchor.context_after ).filter((l) => l !== "") : [];

  const filtered = matches.filter((i) => {
    if (before.length > 0) {
      const start = i - before.length;
      if (start < 0) return false;
      for (let j = 0; j < before.length; j++) {
        if (fileLines[start + j] !== before[j]) return false;
      }
    }
    if (after.length > 0) {
      const start = i + snippetLines.length;
      if (start + after.length > fileLines.length) return false;
      for (let j = 0; j < after.length; j++) {
        if (fileLines[start + j] !== after[j]) return false;
      }
    }
    return true;
  });

  return filtered.length === 1 ? filtered[0]! + 1 : null;
}

function wrapWithBanner(snippet: string, body: string, reason: string): string {
  const quoted = snippet.split("\n").slice(0, 6).join("\n");
  return [
    `> [!NOTE] Could not anchor this comment inline (${reason}). Snippet:`,
    "",
    "```",
    quoted,
    "```",
    "",
    body,
  ].join("\n");
}

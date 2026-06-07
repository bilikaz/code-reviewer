// Pipeline state — uniform shape passed through every stage. Each stage
// takes StageState, returns StageState. Stages mutate `comments` and
// `context.preloadedFiles`; everything else is additive (set once by its
// producing stage).

import type { PRComment, PRMetadata } from "../vcs/types.ts";

// ---- Rendering context — repo dossier the LLM sees ----------------------
//
// Two reasons it lives separately from `state.diff`:
//   - Each file is a structured entry the LLM can reason about by path /
//     size / line count without re-parsing diff text.
//   - Conventions sit alongside file content because they're the same
//     "things the LLM should consider while reviewing."

// A changed file represented as a unified diff. `type` discriminates how
// the diff was rendered:
//   - "full_file": small file — full file content with +/-/space markers
//     (via `-U10000`). Every line of the head-side file is visible.
//   - "big_file":  big file — partial diff (head + hunks). LLM should
//     `Read` if it needs to see regions outside what's shown.
export interface DiffEntry {
  path:      string;
  type:      "full_file" | "big_file";
  lineCount: number;
  size:      number;
  content:   string;
}

// A binary / non-source changed file. Listed by path only — LLM can't
// read it. `suspicious=true` is set when fetch's heuristics flag the file
// as likely-misclassified text (old/new byte sizes nearly identical — a
// real binary edit usually shuffles most bytes). Prompt explains what to
// do about it.
export interface BinaryEntry {
  path:       string;
  size:       number;         // new-side file size (bytes)
  oldSize:    number;         // base-side file size (bytes); 0 if added or unavailable
  suspicious?: boolean;
}

export interface ConventionEntry {
  context: string;            // the rule / principle
  example: string;            // example showing it applied
}

export interface RenderingContext {
  diffs:         DiffEntry[];
  binary_files:  BinaryEntry[];
  conventions:   ConventionEntry[];
}

export function emptyRenderingContext(): RenderingContext {
  return { diffs: [], binary_files: [], conventions: [] };
}

// ---- Context — repo dossier that grows across stages -------------------

export interface StageContext {
  // Static project material (set by fetch).
  projectContext:  string;   // CLAUDE.md sections + standards, rendered
  reviewChecklist: string;   // review checklist file, noise-stripped

  // Where the reviewer is running. LLM tool calls (Read, Bash) execute here.
  workingDir: { cwd: string };

  // Per-file content the LLM sees. fetch populates from diff classification;
  // LLM-using stages append `full_read` entries when the Read tool fires.
  rendering: RenderingContext;
}

// ---- Stage-specific outputs --------------------------------------------

export interface ReviewFinding {
  path: string;
  snippet: string;
  context_before?: string;
  context_after?: string;
  body: string;
  severity: "info" | "warning" | "blocker";
}

export interface ThreadDecision {
  thread_id: string;
  comment_id: string;
  addressed: boolean;
  reason: string;
}

export type Verdict = "approve" | "reject" | "unknown";

export interface VerdictResult {
  verdict: Verdict;
  findingsCount: number;
  blockingFindingsCount: number;
  unaddressedThreadCount: number;
  noReviewableSource: boolean;
  fatal: boolean;
  totals: { tokens: number; healAttempts: number };
}

export interface StageMetric {
  stage: string;
  durationMs: number;
  skipped?: boolean;
  tokens?: { input: number; output: number; total: number };
  healAttempts?: number;
  toolCalls?: number;
  error?: string;
}

// ---- The state object passed through every stage -----------------------

export interface StageState {
  // Static identity from fetch.
  meta: PRMetadata;
  diff: string;                 // unified diff text (also broken out into context.preloadedFiles)

  // Mutable through the pipeline. Stages that touch VCS may refresh.
  comments: PRComment[];

  // Repo dossier — accumulates.
  context: StageContext;

  // Stage-specific outputs, set by their producing stage:
  decisions?: ThreadDecision[];     // set by reconcile
  findings?:  ReviewFinding[];      // set by review
  verdict?:   VerdictResult;        // set by summarize

  // Per-stage telemetry.
  metrics: StageMetric[];
}

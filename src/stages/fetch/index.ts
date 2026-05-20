// fetch — builds the initial StageState from VCS + local repo. Pure setup;
// no LLM, no mutations to the PR.
//
// Per-file diff strategy (mirrors the Python reference):
//   - Small file (lines ≤ fullFileThresholdLines): full file with ±/space
//     markers via `-U10000`. Goes in diffs with type="full_file".
//   - Big file:
//     - High coverage (≥ fullFileCoverageThreshold): promote to `-U10000`,
//       treat as full_file.
//     - First change at line ≤ bigFileHeaderLines: widen to
//       `-U<bigFileHeaderLines>`; git's context naturally pulls in the
//       file top. type="big_file".
//     - Change deeper than header range: narrow diff + plain head text.
//       type="big_file".
//   - Binary / non-source extension: listed by path in binary_files. When
//     old/new sizes are suspiciously close, attach a warning — file may
//     actually be text misclassified due to a missing extension.

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

import type { Ctx } from "../../ctx.ts";
import { firstHunkNewLine, headLinesCovered, runGit } from "../../lib/git.ts";
import { loadStandards, renderStandards } from "./standards.ts";
import type { ChangedFile, PRMetadata } from "../../vcs/types.ts";
import {
  emptyRenderingContext,
  type BinaryEntry,
  type DiffEntry,
  type RenderingContext,
  type StageState,
} from "../types.ts";

const BINARY_SIZE_SIMILARITY_THRESHOLD = 0.8;

export async function runFetch(ctx: Ctx): Promise<StageState> {
  const t0 = Date.now();
  const log = ctx.logger.child("fetch");
  log.info("start", { pr: ctx.config.pr.url });

  const [meta, comments] = await Promise.all([
    ctx.vcs.getPRMetadata(),
    ctx.vcs.getPRComments(),
  ]);
  const changed = await ctx.vcs.getChangedFiles(meta);
  const rendering = await assembleRendering(ctx, meta, changed, log);

  const standards = loadStandards(ctx.config.review.standardsRoot, log);
  const standardsBlock = renderStandards(standards);
  let inlineProjectContext = "";
  const pc = ctx.config.review.projectContext;
  if (pc.source && existsSync(pc.source)) {
    inlineProjectContext = readFileSync(pc.source, "utf-8");
    if (pc.sections.length > 0) inlineProjectContext = sliceSections(inlineProjectContext, pc.sections);
  }
  const projectContext = [inlineProjectContext, standardsBlock].filter(Boolean).join("\n\n");

  let reviewChecklist = "";
  if (ctx.config.review.reviewChecklistPath) {
    const p = ctx.config.review.reviewChecklistPath;
    if (existsSync(p)) reviewChecklist = readFileSync(p, "utf-8");
    else log.warn("checklist.missing", { path: p });
  }

  // Legacy concatenated diff text for the <pr_diff> slot (still used by
  // some prompts as the "main view"). Derived from the rendering entries.
  const concatenated = rendering.diffs.map((d) => d.content).join("\n");

  log.info("done", {
    files: changed.length,
    diffs: rendering.diffs.length,
    binary_files: rendering.binary_files.length,
    comments: comments.length,
  });

  return {
    meta,
    diff: concatenated,
    comments,
    context: {
      projectContext,
      reviewChecklist,
      workingDir: { cwd: process.cwd() },
      rendering,
    },
    metrics: [{ stage: "fetch", durationMs: Date.now() - t0 }],
  };
}

// ---- per-file diff assembly ---------------------------------------------

async function assembleRendering(
  ctx: Ctx,
  meta: PRMetadata,
  changed: ChangedFile[],
  log: ReturnType<Ctx["logger"]["child"]>,
): Promise<RenderingContext> {
  const cfg = ctx.config.review.diffFilter;
  const exts = new Set(cfg.includeExtensions.map((e) => e.toLowerCase()));
  const out = emptyRenderingContext();

  for (const f of changed) {
    // Non-whitelisted extension → binary bucket. Compare sizes; if they're
    // similar enough the file might be text the operator forgot to allow.
    if (exts.size > 0 && !exts.has(extname(f.path).toLowerCase())) {
      const entry = await buildBinaryEntry(meta, f);
      if (entry.suspicious) {
        const ratio = Math.min(entry.oldSize, entry.size) / Math.max(entry.oldSize, entry.size);
        log.warn("binary.suspicious", {
          path:           f.path,
          old_bytes:      entry.oldSize,
          new_bytes:      entry.size,
          similarity_pct: Math.round(ratio * 100),
          note:           "old/new sizes nearly identical — file may be text whose extension isn't in includeExtensions",
        });
      }
      out.binary_files.push(entry);
      continue;
    }

    // Deletion: head-side file is gone. Full deletion patch via -U10000.
    if (f.status === "deleted") {
      const content = await ctx.vcs.getFileDiff(meta, f.path, { context: 10000 });
      pushDiff(out.diffs, f.path, "full_file", content);
      continue;
    }

    const headLineCount = countLinesOnDisk(f.path);
    if (headLineCount === null) {
      out.binary_files.push({ path: f.path, size: 0, oldSize: 0 });
      continue;
    }

    // Small file → inline full file.
    if (headLineCount <= cfg.fullFileThresholdLines) {
      const content = await ctx.vcs.getFileDiff(meta, f.path, { context: 10000 });
      pushDiff(out.diffs, f.path, "full_file", content);
      continue;
    }

    // Big file. Probe with narrow context to find first change + coverage.
    const narrow = await ctx.vcs.getFileDiff(meta, f.path, { context: cfg.narrowContextLines });
    const firstChange = firstHunkNewLine(narrow);
    const coverage = headLineCount > 0 ? headLinesCovered(narrow) / headLineCount : 0;

    if (coverage >= cfg.fullFileCoverageThreshold) {
      // High coverage → promote to full file display.
      const content = await ctx.vcs.getFileDiff(meta, f.path, { context: 10000 });
      pushDiff(out.diffs, f.path, "full_file", content);
      continue;
    }

    if (firstChange !== null && firstChange <= cfg.bigFileHeaderLines) {
      // Earliest change near top — widening context pulls in lines 1..change.
      const content = await ctx.vcs.getFileDiff(meta, f.path, { context: cfg.bigFileHeaderLines });
      pushDiff(out.diffs, f.path, "big_file", content);
      continue;
    }

    // Change is deep in the file: keep the narrow diff and append a plain
    // head preview so the LLM still sees the file's top-level shape.
    const head = readFirstNLines(f.path, cfg.bigFileHeaderLines);
    const composed = [
      narrow,
      "",
      `--- HEAD PREVIEW: ${f.path} (lines 1–${head.split("\n").length} of ${headLineCount}) ---`,
      head,
    ].join("\n");
    pushDiff(out.diffs, f.path, "big_file", composed);
  }

  return out;
}

async function buildBinaryEntry(meta: PRMetadata, f: ChangedFile): Promise<BinaryEntry> {
  const newSize = tryFileSize(f.path);
  const oldSize = await tryOldSize(meta.baseSha, f.oldPath ?? f.path);
  const entry: BinaryEntry = { path: f.path, size: newSize, oldSize };
  if (f.status === "modified" && oldSize > 0 && newSize > 0) {
    const ratio = Math.min(oldSize, newSize) / Math.max(oldSize, newSize);
    if (ratio >= BINARY_SIZE_SIMILARITY_THRESHOLD) {
      entry.suspicious = true;
    }
  }
  return entry;
}

function pushDiff(bucket: DiffEntry[], path: string, type: DiffEntry["type"], content: string): void {
  bucket.push({ path, type, content, lineCount: content.split("\n").length, size: content.length });
}

function tryFileSize(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function tryOldSize(baseSha: string, path: string): Promise<number> {
  try {
    const out = (await runGit(["cat-file", "-s", `${baseSha}:${path}`])).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function countLinesOnDisk(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8").split("\n").length;
  } catch {
    return null;
  }
}

function readFirstNLines(path: string, n: number): string {
  try {
    if (!existsSync(path) || n <= 0) return "";
    return readFileSync(path, "utf-8").split("\n").slice(0, n).join("\n");
  } catch {
    return "";
  }
}

function sliceSections(text: string, sections: string[]): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let keep = false;
  let keepDepth = 0;
  for (const line of lines) {
    const m = line.match(/^(#+)\s+(.+?)\s*$/);
    if (m) {
      const depth = m[1]!.length;
      const heading = `${"#".repeat(depth)} ${m[2]!}`;
      if (sections.includes(heading)) {
        keep = true;
        keepDepth = depth;
        out.push(line);
        continue;
      }
      if (keep && depth <= keepDepth) keep = false;
    }
    if (keep) out.push(line);
  }
  return out.join("\n").trim();
}

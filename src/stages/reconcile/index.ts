// reconcile — judges prior bot inline threads against the new diff. Three phases:
//
//   1. Rename relocation — for any thread on an old path that was renamed,
//      post a notice on the new path at line 1 and resolve the orphan.
//   2. Auto-address — threads whose target file no longer exists in the
//      working tree are marked addressed=true deterministically (no LLM).
//   3. verify() — LLM judges the remaining threads.

import { existsSync } from "node:fs";

import type { Ctx } from "../../ctx.ts";
import { errorMessage } from "../../lib/errors.ts";
import { callLLM } from "../../llm/client.ts";
import { isOpenBotThread, type PRComment } from "../../providers/types.ts";
import { baseSystemSections, baseUserSections, llmStageMetric, loadPromptAssets } from "../shared.ts";
import type { StageState, ThreadDecision } from "../types.ts";

const ASSETS = loadPromptAssets(import.meta.dirname);

const RENAME_BANNER_PREFIX = "⚠ **File renamed:** ";

interface VerifyPayload {
  decisions: ThreadDecision[];
}

function splitThreads(comments: PRComment[]): { auto: PRComment[]; rest: PRComment[] } {
  const auto: PRComment[] = [];
  const rest: PRComment[] = [];
  for (const c of comments) {
    if (!isOpenBotThread(c)) continue;
    if (c.inline.path && !existsSync(c.inline.path)) auto.push(c);
    else rest.push(c);
  }
  return { auto, rest };
}

function gatherReplies(comments: PRComment[], threadIds: Set<string>): PRComment[] {
  return comments.filter((c) => c.parentId && threadIds.has(c.parentId));
}

function hasRenameNotice(comments: PRComment[], newPath: string, oldPath: string): boolean {
  const expectedPrefix = `${RENAME_BANNER_PREFIX}\`${oldPath}\` → \`${newPath}\``;
  for (const c of comments) {
    if (c.by !== "bot") continue;
    if (!c.inline || c.inline.path !== newPath || c.inline.line !== 1) continue;
    if ((c.body || "").startsWith(expectedPrefix)) return true;
  }
  return false;
}

async function handleRenames(
  ctx: Ctx,
  comments: PRComment[],
  renames: { [oldPath: string]: string },
): Promise<number> {
  if (!Object.keys(renames).length) return 0;
  const log = ctx.logger.child("reconcile.rename");

  let count = 0;
  for (const c of comments) {
    if (c.by !== "bot" || c.resolved) continue;
    if (!c.inline) continue;
    const oldPath = c.inline.path;
    if (!oldPath || !(oldPath in renames)) continue;
    const newPath = renames[oldPath]!;
    if (!existsSync(newPath)) {
      log.warn("target.missing", { thread: c.id, oldPath, newPath });
      continue;
    }
    const alreadyPosted = hasRenameNotice(comments, newPath, oldPath);
    try {
      if (!alreadyPosted) {
        const notice =
          `${RENAME_BANNER_PREFIX}\`${oldPath}\` → \`${newPath}\`. ` +
          `This was a prior bot finding on the old path; please verify ` +
          `whether it still applies in the new location.\n\n` +
          `**Original finding:**\n\n${c.body || ""}`;
        await ctx.provider.postInlineComment({ path: newPath, line: 1, body: notice });
      }
      await ctx.provider.resolveThread(c.threadId ?? c.id);
      count++;
      log.info(alreadyPosted ? "re_resolved" : "relocated", { thread: c.id, oldPath, newPath });
    } catch (e) {
      log.error("relocate.failed", { thread: c.id, oldPath, newPath, error: errorMessage(e) });
    }
  }
  return count;
}

async function applyResolutions(
  ctx: Ctx,
  byCommentId: Map<string, PRComment>,
  decisions: ThreadDecision[],
): Promise<void> {
  const log = ctx.logger.child("reconcile.resolve");
  let resolved = 0, failed = 0, skipped = 0;
  for (const d of decisions) {
    if (!d.addressed) continue;
    const comment = byCommentId.get(d.comment_id);
    if (!comment?.threadId) {
      log.warn("missing_thread_id", { comment_id: d.comment_id });
      skipped++;
      continue;
    }
    try {
      await ctx.provider.resolveThread(comment.threadId);
      resolved++;
    } catch (e) {
      log.error("resolve.failed", { thread: comment.threadId, error: errorMessage(e) });
      failed++;
    }
  }
  if (resolved || skipped || failed) {
    log.info("summary", { resolved, skipped, failed });
  }
}

export async function runReconcile(ctx: Ctx, state: StageState): Promise<StageState> {
  const t0 = Date.now();
  const log = ctx.logger.child("reconcile");

  let comments = state.comments;

  const renames = await ctx.provider.getRenames(state.meta);
  if (Object.keys(renames).length > 0) {
    const relocated = await handleRenames(ctx, comments, renames);
    if (relocated > 0) comments = await ctx.provider.getPRComments();
  }

  const { auto, rest } = splitThreads(comments);
  const byCommentId = new Map<string, PRComment>(comments.map((c) => [c.id, c]));

  // Before auto-addressing threads on vanished files, warn if any of those
  // paths look like a sub-confident rename — they'd otherwise be silently
  // marked addressed when in fact a moved file may still carry the concern.
  if (auto.length > 0) {
    const potential = await ctx.provider.getPotentialRenames(state.meta);
    if (potential.length > 0) {
      const potByOld = new Map(potential.map((p) => [p.oldPath, p]));
      for (const c of auto) {
        const oldPath = c.inline?.path;
        if (oldPath && potByOld.has(oldPath)) {
          const p = potByOld.get(oldPath)!;
          log.warn("potential_rename.auto_address", {
            thread:        c.id,
            oldPath,
            newPathGuess:  p.newPath,
            similarityPct: p.similarityPct,
            note:          "git's similarity score is below the 50% confident-rename threshold; treating as deletion. If this is in fact a rename, the original concern may still apply on the new path — verify manually.",
          });
        }
      }
    }
  }

  const autoDecisions: ThreadDecision[] = auto.map((c) => ({
    thread_id: c.threadId ?? c.id,
    comment_id: c.id,
    addressed: true,
    reason: `File \`${c.inline?.path}\` no longer exists in the PR head; the concern no longer applies.`,
  }));
  if (auto.length > 0) log.info("auto_addressed", { count: auto.length });

  await applyResolutions(ctx, byCommentId, autoDecisions);

  if (rest.length === 0) {
    log.info("no_llm_needed", { reason: auto.length > 0 ? "all_paths_gone" : "no_unresolved_bot_threads" });
    return {
      ...state,
      comments,
      decisions: autoDecisions,
      metrics: [...state.metrics, { stage: "reconcile", durationMs: Date.now() - t0, skipped: true }],
    };
  }

  const threadIds = new Set(rest.map((c) => c.id));
  const replies = gatherReplies(comments, threadIds);
  log.info("llm_judging", { threads: rest.length, reply_context: replies.length });

  const systemSections = baseSystemSections(ASSETS, state);
  const userSections = baseUserSections(state, [...rest, ...replies]);

  const result = await callLLM<VerifyPayload>({
    ctx,
    stage: "reconcile",
    systemSections,
    userSections,
    schema: ASSETS.schema,
  });
  const llmDecisions = result.validated.decisions ?? [];
  await applyResolutions(ctx, byCommentId, llmDecisions);

  return {
    ...state,
    comments,
    decisions: [...autoDecisions, ...llmDecisions],
    metrics: [...state.metrics, llmStageMetric("reconcile", t0, result)],
  };
}

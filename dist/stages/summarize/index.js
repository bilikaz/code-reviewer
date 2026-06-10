// summarize — derives the final verdict, posts the summary comment, and
// sets the PR verdict on the provider. No file writes — verdict signal is
// state.verdict + (in cli.ts) the process exit code.
import { errorMessage } from "../../lib/errors.js";
import { isOpenBotThread } from "../../providers/types.js";
// Fragments that identify a bot comment as one of OUR summary comments.
// buildSummary interpolates these exact constants into the text it posts,
// and isPriorSummary matches on the same list — construction and detection
// can't drift apart (ADR-0012). Reword a block by editing its constant.
const FRAG_UNADDRESSED = "prior bot finding(s) still unaddressed";
const FRAG_NO_SOURCE = "No reviewable source content";
const FRAG_INFO = "informational finding(s)";
const SUMMARY_FRAGMENTS = [FRAG_UNADDRESSED, FRAG_NO_SOURCE, FRAG_INFO];
function isPriorSummary(c) {
    if (c.by !== "bot" || c.inline)
        return false;
    return SUMMARY_FRAGMENTS.some((f) => c.body.includes(f));
}
function deriveVerdict(ctx, state) {
    const blockingSeverities = new Set(ctx.config.review.verdictGuard.approveBlockingSeverities);
    const findings = state.findings ?? [];
    const blocking = findings.filter((c) => blockingSeverities.has(c.severity));
    const infoFindings = findings.filter((c) => !blockingSeverities.has(c.severity));
    let unaddressed;
    if (state.decisions !== undefined) {
        unaddressed = state.decisions.filter((d) => !d.addressed);
    }
    else {
        // Reconcile didn't run. Treat every unresolved bot inline thread as
        // still pending — we don't know whether the head addresses them.
        unaddressed = state.comments
            .filter(isOpenBotThread)
            .map((c) => ({
            thread_id: c.threadId ?? c.id,
            comment_id: c.id,
            addressed: false,
            reason: "Reconcile did not run; prior bot finding has not been re-judged against the current head.",
        }));
    }
    const noReviewableSource = !/^diff --git /m.test(state.diff);
    const verdict = blocking.length || unaddressed.length || noReviewableSource ? "reject" : "approve";
    return { verdict, blocking, unaddressed, infoFindings, noReviewableSource };
}
function clip(s, cap) {
    return s.length > cap ? s.slice(0, cap) + "…" : s;
}
function buildSummary(d, charLimit) {
    const blocks = [];
    if (d.verdict === "reject" && d.unaddressed.length > 0) {
        const lines = [`**${d.unaddressed.length} ${FRAG_UNADDRESSED}:**`, ""];
        for (const dec of d.unaddressed) {
            const tid = dec.thread_id || dec.comment_id;
            const reason = clip((dec.reason || "").trim(), charLimit);
            lines.push(`- thread \`${tid}\` — ${reason}`);
        }
        blocks.push(lines.join("\n"));
    }
    if (d.verdict === "reject" && d.noReviewableSource) {
        blocks.push(`**${FRAG_NO_SOURCE}** in this PR — all changed files are binary or non-whitelisted (translations, lockfiles, assets, etc.). Bot can't read them; a human reviewer must confirm the change set is intentional before merge.`);
    }
    if (d.infoFindings.length > 0) {
        const lines = [
            `**${d.infoFindings.length} ${FRAG_INFO}** (nits / suggestions, not blocking — listed here as summary, not tracked as individual threads):`,
            "",
        ];
        for (const c of d.infoFindings) {
            const path = c.path || "?";
            const first = c.body.split("\n")[0] ?? "";
            lines.push(`- \`${path}\` — ${clip(first, charLimit)}`);
        }
        blocks.push(lines.join("\n"));
    }
    return blocks.join("\n\n");
}
function totals(state) {
    let tokens = 0, healAttempts = 0;
    for (const m of state.metrics) {
        if (m.tokens)
            tokens += m.tokens.total;
        healAttempts += m.healAttempts ?? 0;
    }
    return { tokens, healAttempts };
}
export async function runSummarize(ctx, state) {
    const t0 = Date.now();
    const log = ctx.logger.child("summarize");
    const d = deriveVerdict(ctx, state);
    log.info("verdict.derived", {
        verdict: d.verdict,
        blocking: d.blocking.length,
        unaddressed: d.unaddressed.length,
        no_reviewable_source: d.noReviewableSource,
    });
    let deleted = 0;
    for (const c of state.comments) {
        if (!isPriorSummary(c))
            continue;
        try {
            await ctx.provider.deleteComment(c.id, "issue");
            deleted++;
        }
        catch (e) {
            log.warn("delete.prior_summary_failed", { id: c.id, error: errorMessage(e) });
        }
    }
    if (deleted)
        log.info("prior_summaries.deleted", { count: deleted });
    const summary = buildSummary(d, ctx.config.review.summaryCommentCharLimit);
    let verdictError = null;
    if (d.verdict !== "unknown") {
        try {
            const post = d.verdict === "approve" ? ctx.provider.approve(summary || undefined)
                : ctx.provider.reject(summary || undefined);
            await post;
        }
        catch (e) {
            verdictError = errorMessage(e);
            log.error("verdict.failed", { verdict: d.verdict, error: verdictError });
        }
    }
    // Fatal gates CI: approve verdict is the only non-fatal outcome.
    // reject / unknown / verdict-call failure → exit 1.
    const fatal = d.verdict !== "approve" || verdictError !== null;
    if (fatal) {
        if (verdictError)
            log.error("fatal.verdict_failed", { verdict: d.verdict, error: verdictError });
        else if (d.verdict === "unknown")
            log.error("fatal.no_review_result");
        else if (d.verdict === "reject")
            log.error("fatal.rejected");
    }
    const verdict = {
        verdict: d.verdict,
        findingsCount: (state.findings ?? []).length,
        blockingFindingsCount: d.blocking.length,
        unaddressedThreadCount: d.unaddressed.length,
        noReviewableSource: d.noReviewableSource,
        fatal,
        totals: totals(state),
    };
    return {
        ...state,
        verdict,
        metrics: [...state.metrics, { stage: "summarize", durationMs: Date.now() - t0 }],
    };
}

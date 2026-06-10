// Helpers shared between LLM-using stages (reconcile, review): prompt-asset
// loading, the slot-tag table, base section assembly, and metric construction
// (ADR-0010). Helpers encode the envelope (order + presence rules); stages
// keep policy — they append their stage-specific sections to the returned
// arrays.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// Loads a stage's colocated prompt.md + schema.json (ADR-0006). Call at
// module init with import.meta.dirname — a missing asset fails fast at
// import time.
export function loadPromptAssets(dir) {
    const prompt = readFileSync(resolve(dir, "prompt.md"), "utf-8");
    const schemaText = readFileSync(resolve(dir, "schema.json"), "utf-8");
    return { prompt, schemaText, schema: JSON.parse(schemaText) };
}
// ---- Prompt slots --------------------------------------------------------
// Every XML tag any stage may inject. One table so tag names can't drift
// between stages; prompts document the tags they consume.
export const SLOT = {
    outputSchema: "output_schema",
    projectContext: "project_context",
    prMetadata: "pr_metadata",
    prDiff: "pr_diff",
    prComments: "pr_comments",
    threadDecisions: "thread_decisions",
    reviewChecklist: "review_checklist",
    renderingContext: "rendering_context",
};
// System envelope: prompt → output_schema → project_context → (checklist) →
// rendering_context. Empty sections are omitted.
export function baseSystemSections(assets, state, opts) {
    const sections = [
        { tag: "", content: assets.prompt },
        { tag: SLOT.outputSchema, content: assets.schemaText },
    ];
    if (state.context.projectContext.trim()) {
        sections.push({ tag: SLOT.projectContext, content: state.context.projectContext });
    }
    if (opts?.includeChecklist && state.context.reviewChecklist) {
        sections.push({ tag: SLOT.reviewChecklist, content: state.context.reviewChecklist });
    }
    if (hasRendering(state.context.rendering)) {
        sections.push({ tag: SLOT.renderingContext, content: renderRenderingContext(state.context.rendering) });
    }
    return sections;
}
// User envelope: pr_metadata → pr_diff → pr_comments. The comment set is a
// parameter because stages scope it differently (review sends all comments;
// reconcile sends only the threads under judgment plus their replies).
export function baseUserSections(state, comments) {
    return [
        { tag: SLOT.prMetadata, content: JSON.stringify(state.meta, null, 2) },
        { tag: SLOT.prDiff, content: state.diff },
        { tag: SLOT.prComments, content: JSON.stringify(comments, null, 2) },
    ];
}
// ---- Metrics --------------------------------------------------------------
export function llmStageMetric(stage, t0, r) {
    return {
        stage,
        durationMs: Date.now() - t0,
        tokens: { input: r.usage.promptTokens, output: r.usage.completionTokens, total: r.usage.totalTokens },
        healAttempts: r.healAttempts,
        toolCalls: r.toolCalls,
    };
}
// ---- Rendering context ----------------------------------------------------
// Renders a RenderingContext into the body of a <rendering_context> slot.
// Each sub-bucket becomes its own block; empty buckets are skipped. The LLM
// sees structured sections it can scan by type and walk by file.
export function renderRenderingContext(rc) {
    const blocks = [];
    if (rc.diffs.length > 0) {
        const items = rc.diffs.map((d) => `<diff file="${d.path}" type="${d.type}" lines="${d.lineCount}" bytes="${d.size}">\n${d.content}\n</diff>`);
        blocks.push(`<diffs>\n${items.join("\n\n")}\n</diffs>`);
    }
    if (rc.binary_files.length > 0) {
        const items = rc.binary_files.map((b) => {
            const tag = b.suspicious ? ` suspicious="true"` : "";
            return `<binary_file file="${b.path}" bytes="${b.size}" old_bytes="${b.oldSize}"${tag} />`;
        });
        blocks.push(`<binary_files>\n${items.join("\n")}\n</binary_files>`);
    }
    if (rc.conventions.length > 0) {
        const items = rc.conventions.map((c) => `<convention>\n  <context>${c.context}</context>\n  <example>${c.example}</example>\n</convention>`);
        blocks.push(`<conventions>\n${items.join("\n")}\n</conventions>`);
    }
    return blocks.join("\n\n");
}
export function hasRendering(rc) {
    return rc.diffs.length + rc.binary_files.length + rc.conventions.length > 0;
}

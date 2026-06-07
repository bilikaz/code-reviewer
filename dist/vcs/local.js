// Local provider — review the current git checkout's branch against a base
// ref (default `main`) with no VCS API and no network. Selected by a
// `local://<base>` PR URL (e.g. `--pr local://main`).
//
// Changed-files / diffs reuse the exact same `lib/git` helpers the real
// providers use, so there's no new diff logic. There's no remote to post to,
// so the write methods instead echo each action to the console — the same
// comments / verdict a real provider would post, just printed (like git's
// own progress output). Pairs well with running a small local model
// (LLM_URL / LLM_MODEL) for fast pre-push review while CI uses a heavier one.
import { gitChangedFiles, gitFileDiff, gitPotentialRenames, runGit } from "../lib/git.js";
// ANSI color, on only for an interactive stdout (TTY, no NO_COLOR) so
// redirected / piped output stays plain. Raw escapes — no dependency.
const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const sgr = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => sgr("1", s);
const dim = (s) => sgr("2", s);
const red = (s) => sgr("31", s);
const green = (s) => sgr("32", s);
const yellow = (s) => sgr("33", s);
const cyan = (s) => sgr("36", s);
function out(line) {
    process.stdout.write(line + "\n");
}
// Severity badge, colored: blocker red, warning yellow, info cyan.
function badge(severity) {
    switch (severity) {
        case "blocker": return red("blocker");
        case "warning": return yellow("warning");
        default: return cyan("info");
    }
}
export class LocalVcsProvider {
    meta;
    name = "local";
    constructor(meta) {
        this.meta = meta;
    }
    static async create(config) {
        const m = config.pr.url.match(/^local:\/\/(.*)$/);
        const base = (m?.[1] ?? "").trim() || "main";
        const headSha = (await runGit(["rev-parse", "HEAD"])).trim();
        let baseSha;
        try {
            baseSha = (await runGit(["rev-parse", base])).trim();
        }
        catch {
            throw new Error(`local: base ref "${base}" not found in this repo. Use --pr local://<branch> with an existing ref (default: main).`);
        }
        const headBranch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        const author = (await runGit(["log", "-1", "--format=%an"]).catch(() => "")).trim();
        const title = (await runGit(["log", "-1", "--format=%s"]).catch(() => "")).trim();
        return new LocalVcsProvider({
            title: title || `${headBranch} vs ${base}`,
            description: "",
            author: author || "local",
            baseBranch: base,
            headBranch,
            baseSha,
            headSha,
            url: config.pr.url,
            state: "open",
        });
    }
    async getPRMetadata() {
        return this.meta;
    }
    async getChangedFiles(meta) {
        return gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha });
    }
    async getPotentialRenames(meta) {
        return gitPotentialRenames({ baseSha: meta.baseSha, headSha: meta.headSha });
    }
    async getFileDiff(meta, path, opts) {
        return gitFileDiff({ baseSha: meta.baseSha, headSha: meta.headSha, path, context: opts.context });
    }
    async getPRComments() {
        return [];
    }
    // No remote to post to — echo each action to the console instead.
    async postInlineComment(c) {
        out(`\n${badge(c.severity)} ${bold(`${c.path}:${c.line}`)}`);
        out(c.body);
    }
    async postSummaryComment(body) {
        out(`\n${cyan("● summary")}`);
        out(body);
    }
    async approve(summary) {
        out(`\n${green("✓ approved")}`);
        if (summary)
            out(summary);
    }
    async reject(summary) {
        out(`\n${red("✗ rejected")}`);
        if (summary)
            out(summary);
    }
    async resolveThread(threadId) {
        out(dim(`↳ resolved thread ${threadId}`));
    }
    async deleteComment(commentId, kind) {
        out(dim(`↳ deleted ${kind} comment ${commentId}`));
    }
    async getRenames(meta) {
        const changed = await gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha });
        const out = {};
        for (const f of changed) {
            if (f.status === "renamed" && f.oldPath)
                out[f.oldPath] = f.path;
        }
        return out;
    }
}

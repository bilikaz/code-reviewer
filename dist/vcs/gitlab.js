// GitLab implementation of VcsProvider. Plain fetch — no official SDK needed
// for the subset we use.
//
// Token needs:
//   - `api` scope to read/write MR comments and submit reviews
//   - `read_repository` scope to read diffs
//
// `baseUrl` defaults to https://gitlab.com/api/v4; self-hosted instances pass
// their own.
import { gitChangedFiles, gitFileDiff, gitPotentialRenames } from "../lib/git.js";
export class GitLabProvider {
    token;
    baseUrl;
    projectPath;
    number;
    botLogin;
    name = "gitlab";
    constructor(token, baseUrl, projectPath, // {host}/{owner}/{repo}
    number, botLogin) {
        this.token = token;
        this.baseUrl = baseUrl;
        this.projectPath = projectPath;
        this.number = number;
        this.botLogin = botLogin;
    }
    static async create(config) {
        const { url } = config.pr;
        const { token, baseUrl } = config.gitlab;
        if (!token)
            throw new Error("GitLabProvider: token required");
        // {host}/{owner}/{repo}/-/merge_requests/{n}
        const m = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/-\/merge_requests\/(\d+)/);
        if (!m)
            throw new Error(`GitLabProvider: not a GitLab MR URL: ${url}`);
        const resolvedBaseUrl = (baseUrl || "https://gitlab.com/api/v4").replace(/\/$/, "");
        const projectPath = `${m[1]}/${m[2]}/${m[3]}`;
        const me = await GitLabProvider.api(resolvedBaseUrl, token, "/user");
        return new GitLabProvider(token, resolvedBaseUrl, projectPath, parseInt(m[4], 10), me.username);
    }
    // Static so create() can use it before the instance exists.
    static async api(baseUrl, token, path, opts) {
        const resp = await fetch(`${baseUrl}${path}`, {
            ...opts,
            headers: {
                "PRIVATE-TOKEN": token,
                "Content-Type": "application/json",
                ...(opts?.headers ?? {}),
            },
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`GitLab API ${resp.status}: ${text.slice(0, 1024)}`);
        }
        return resp.json();
    }
    api(path, opts) {
        return GitLabProvider.api(this.baseUrl, this.token, path, opts);
    }
    mrPath() {
        return `/projects/${encodeURIComponent(this.projectPath)}/merge_requests/${this.number}`;
    }
    async getPRMetadata() {
        const mr = await this.api(this.mrPath());
        return {
            title: mr.title,
            description: mr.description ?? "",
            author: mr.author.username,
            baseBranch: mr.target_branch,
            headBranch: mr.source_branch,
            baseSha: mr.diff_refs.base_sha,
            headSha: mr.diff_refs.head_sha,
            url: mr.web_url,
            state: mr.state === "merged" ? "merged" : mr.state,
        };
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
        const out = [];
        const notes = await this.api(`${this.mrPath()}/notes?per_page=100&sort=asc`);
        for (const n of notes) {
            if (n.position)
                continue;
            out.push({
                id: String(n.id),
                by: n.author.username === this.botLogin ? "bot" : "human",
                author: n.author.username,
                body: n.body,
                createdAt: n.created_at,
                resolved: n.resolvable ? n.resolved : undefined,
                threadId: n.thread_id ? String(n.thread_id) : undefined,
            });
        }
        for (const n of notes.filter((nn) => nn.position != null)) {
            const pos = n.position;
            const line = pos.new_line ?? pos.old_line ?? 0;
            out.push({
                id: String(n.id),
                threadId: n.thread_id ? String(n.thread_id) : undefined,
                by: n.author.username === this.botLogin ? "bot" : "human",
                author: n.author.username,
                body: n.body,
                createdAt: n.created_at,
                inline: { path: pos.new_path || pos.old_path, line, side: "head" },
                parentId: n.parent_id ? String(n.parent_id) : undefined,
                resolved: n.resolvable ? n.resolved : undefined,
            });
        }
        return out;
    }
    async postInlineComment(c) {
        const meta = await this.getPRMetadata();
        await this.api(`${this.mrPath()}/discussions`, {
            method: "POST",
            body: JSON.stringify({
                body: c.body,
                position: {
                    base_sha: meta.baseSha,
                    start_sha: meta.baseSha,
                    head_sha: meta.headSha,
                    position_type: "text",
                    new_path: c.path,
                    new_line: c.line,
                },
            }),
        });
    }
    async postSummaryComment(body) {
        await this.api(`${this.mrPath()}/notes`, {
            method: "POST",
            body: JSON.stringify({ body }),
        });
    }
    async approve(summary) {
        if (summary)
            await this.postSummaryComment(summary);
        await this.api(`${this.mrPath()}/approve`, { method: "POST" });
    }
    async reject(summary) {
        // GitLab has no native request_changes action — only the comment lands.
        if (summary)
            await this.postSummaryComment(summary);
    }
    async resolveThread(threadId) {
        await this.api(`${this.mrPath()}/discussions/${threadId}/resolve`, { method: "PUT" });
    }
    async deleteComment(commentId, _kind) {
        await this.api(`${this.mrPath()}/notes/${commentId}`, { method: "DELETE" });
    }
    async getRenames(_meta) {
        const changes = await this.api(`${this.mrPath()}/changes`);
        const out = {};
        for (const file of changes.changes ?? []) {
            if (file.renamed_to && file.renamed_from) {
                out[file.renamed_from] = file.renamed_to;
            }
            else if (file.old_path && file.new_path && file.old_path !== file.new_path) {
                out[file.old_path] = file.new_path;
            }
        }
        return out;
    }
}

// Bitbucket implementation of VcsProvider. REST API v2 via fetch.
//
// Token needs:
//   - Cloud (bitbucket.org): App Password or OAuth token with `pullrequest:write`, `repository:read`.
//   - Server (self-hosted): PAT with `REPO_READ` + `PULL_REQUEST_WRITE`.
//
// baseUrl defaults to https://api.bitbucket.org/2.0; self-hosted instances pass their own.
import { gitChangedFiles, gitFileDiff, gitPotentialRenames } from "../lib/git.js";
export class BitbucketProvider {
    token;
    baseUrl;
    owner;
    repo;
    number;
    botLogin;
    name = "bitbucket";
    constructor(token, baseUrl, owner, repo, number, botLogin) {
        this.token = token;
        this.baseUrl = baseUrl;
        this.owner = owner;
        this.repo = repo;
        this.number = number;
        this.botLogin = botLogin;
    }
    static async create(config) {
        const { url } = config.pr;
        const { token, baseUrl } = config.bitbucket;
        if (!token)
            throw new Error("BitbucketProvider: token required");
        let owner, repo, num;
        const cloud = url.match(/^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/);
        const server = url.match(/^https?:\/\/[^/]+\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/);
        const m = cloud ?? server;
        if (!m)
            throw new Error(`BitbucketProvider: not a Bitbucket PR URL: ${url}`);
        owner = m[1];
        repo = m[2];
        num = parseInt(m[3], 10);
        const resolvedBaseUrl = (baseUrl || "https://api.bitbucket.org/2.0").replace(/\/$/, "");
        const me = await BitbucketProvider.api(resolvedBaseUrl, token, "/user");
        return new BitbucketProvider(token, resolvedBaseUrl, owner, repo, num, me.username);
    }
    static async api(baseUrl, token, path, opts) {
        const resp = await fetch(`${baseUrl}${path}`, {
            ...opts,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(opts?.headers ?? {}),
            },
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`Bitbucket API ${resp.status}: ${text.slice(0, 1024)}`);
        }
        return resp.json();
    }
    api(path, opts) {
        return BitbucketProvider.api(this.baseUrl, this.token, path, opts);
    }
    prPath() {
        return `/repositories/${this.owner}/${this.repo}/pullrequests/${this.number}`;
    }
    async getPRMetadata() {
        const pr = await this.api(this.prPath());
        return {
            title: pr.title,
            description: pr.description ?? "",
            author: pr.author.username,
            baseBranch: pr.destination.branch.name,
            headBranch: pr.source.branch.name,
            baseSha: pr.destination.commit.hash,
            headSha: pr.source.commit.hash,
            url: pr.links.html.href,
            state: pr.state.name === "MERGED" ? "merged" : (pr.state.name === "OPEN" ? "open" : "closed"),
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
        const comments = await this.api(`${this.prPath()}/comments?pagelen=100`);
        for (const c of comments.values ?? []) {
            const body = c.content?.raw ?? c.body?.raw ?? "";
            out.push({
                id: String(c.id),
                threadId: String(c.id),
                by: c.author.username === this.botLogin ? "bot" : "human",
                author: c.author.username,
                body,
                createdAt: c.created_on,
                inline: c.inline
                    ? { path: c.inline.path, line: c.inline.line?.to ?? c.inline.line?.from ?? 0, side: "head" }
                    : undefined,
                parentId: c.parent ? String(c.parent.id) : undefined,
                resolved: c.resolved,
            });
        }
        return out;
    }
    async postInlineComment(c) {
        await this.api(`${this.prPath()}/comments`, {
            method: "POST",
            body: JSON.stringify({
                content: { raw: c.body },
                inline: { path: c.path, to: c.line, type: "inline" },
            }),
        });
    }
    async postSummaryComment(body) {
        await this.api(`${this.prPath()}/comments`, {
            method: "POST",
            body: JSON.stringify({ content: { raw: body } }),
        });
    }
    async approve(summary) {
        if (summary)
            await this.postSummaryComment(summary);
        await this.api(`${this.prPath()}/approve`, { method: "POST" });
    }
    async reject(summary) {
        // Bitbucket has no native request_changes action — only the comment lands.
        if (summary)
            await this.postSummaryComment(summary);
    }
    async resolveThread(threadId) {
        await this.api(`${this.prPath()}/comments/${threadId}`, {
            method: "PUT",
            body: JSON.stringify({ resolved: true }),
        });
    }
    async deleteComment(commentId, _kind) {
        await this.api(`${this.prPath()}/comments/${commentId}`, { method: "DELETE" });
    }
    async getRenames(_meta) {
        const diff = await this.api(`${this.prPath()}/diff`);
        const out = {};
        for (const file of diff.values ?? []) {
            if (file.status === "renamed" && file.old?.path && file.new?.path) {
                out[file.old.path] = file.new.path;
            }
        }
        return out;
    }
}

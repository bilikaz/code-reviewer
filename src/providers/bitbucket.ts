// Bitbucket implementation of Provider. REST API v2 via fetch.
//
// Token needs:
//   - Cloud (bitbucket.org): App Password or OAuth token with `pullrequest:write`, `repository:read`.
//   - Server (self-hosted): PAT with `REPO_READ` + `PULL_REQUEST_WRITE`.
//
// baseUrl defaults to https://api.bitbucket.org/2.0; self-hosted instances pass their own.

import type { Config } from "../ctx.ts";
import { BaseProvider } from "./base.ts";
import type { InlinePost, PRComment, PRMetadata, Provider } from "./types.ts";

type Api = (path: string, init?: RequestInit) => Promise<unknown>;

// Fetch wrapper owned by this provider — deliberately NOT shared with
// gitlab.ts: the two wrappers look alike today only by coincidence, and
// the APIs will diverge (pagination, rate limits, auth). See docs/conventions/consolidation.md.
function makeApi(baseUrl: string, token: string): Api {
  return async (path, init) => {
    const resp = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Bitbucket API ${resp.status}: ${text.slice(0, 1024)}`);
    }
    return resp.json() as Promise<unknown>;
  };
}

interface BitbucketPR {
  id: number;
  title: string;
  description?: string;
  state: { name: string };
  author: { username: string; uuid: string };
  source: { branch: { name: string }; commit: { hash: string } };
  destination: { branch: { name: string }; commit: { hash: string } };
  links: { html: { href: string } };
}

interface BitbucketComment {
  id: number;
  author: { username: string; uuid: string };
  created_on: string;
  updated_on: string;
  content?: { raw: string };
  body?: { raw: string };
  inline?: { path: string; line: { to?: number; from?: number }; type: string };
  parent?: { id: number };
  resolved?: boolean;
}

export class BitbucketProvider extends BaseProvider implements Provider {
  readonly name = "bitbucket" as const;

  private constructor(
    private readonly api: Api,
    private readonly owner: string,
    private readonly repo: string,
    private readonly number: number,
    private readonly botLogin: string,
  ) {
    super();
  }

  static async create(config: Config): Promise<BitbucketProvider> {
    const { url } = config.pr;
    const { token, baseUrl } = config.bitbucket;
    if (!token) throw new Error("BitbucketProvider: token required");
    const cloud  = url.match(/^https?:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/);
    const server = url.match(/^https?:\/\/[^/]+\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/);
    const m = cloud ?? server;
    if (!m) throw new Error(`BitbucketProvider: not a Bitbucket PR URL: ${url}`);
    const api = makeApi((baseUrl || "https://api.bitbucket.org/2.0").replace(/\/$/, ""), token);
    const me = await api("/user") as { username: string };
    return new BitbucketProvider(api, m[1]!, m[2]!, parseInt(m[3]!, 10), me.username);
  }

  private prPath(): string {
    return `/repositories/${this.owner}/${this.repo}/pullrequests/${this.number}`;
  }

  async getPRMetadata(): Promise<PRMetadata> {
    const pr = await this.api(this.prPath()) as BitbucketPR;
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

  async getPRComments(): Promise<PRComment[]> {
    const out: PRComment[] = [];
    const comments = await this.api(`${this.prPath()}/comments?pagelen=100`) as { values?: BitbucketComment[] };
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

  async postInlineComment(c: InlinePost): Promise<void> {
    await this.api(`${this.prPath()}/comments`, {
      method: "POST",
      body: JSON.stringify({
        content: { raw: c.body },
        inline: { path: c.path, to: c.line, type: "inline" },
      }),
    });
  }

  async postSummaryComment(body: string): Promise<void> {
    await this.api(`${this.prPath()}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: { raw: body } }),
    });
  }

  async approve(summary?: string): Promise<void> {
    if (summary) await this.postSummaryComment(summary);
    await this.api(`${this.prPath()}/approve`, { method: "POST" });
  }

  async reject(summary?: string): Promise<void> {
    // Bitbucket has no native request_changes action — only the comment lands.
    if (summary) await this.postSummaryComment(summary);
  }

  async resolveThread(threadId: string): Promise<void> {
    await this.api(`${this.prPath()}/comments/${threadId}`, {
      method: "PUT",
      body: JSON.stringify({ resolved: true }),
    });
  }

  async deleteComment(commentId: string, _kind: "issue" | "review"): Promise<void> {
    await this.api(`${this.prPath()}/comments/${commentId}`, { method: "DELETE" });
  }

  // Bitbucket's diffstat reports renames directly — richer than the base
  // class's git -M derivation.
  override async getRenames(_meta: PRMetadata): Promise<{ [oldPath: string]: string }> {
    const diff = await this.api(`${this.prPath()}/diff`) as {
      values?: { status: string; old?: { path: string }; new?: { path: string } }[];
    };
    const out: { [oldPath: string]: string } = {};
    for (const file of diff.values ?? []) {
      if (file.status === "renamed" && file.old?.path && file.new?.path) {
        out[file.old.path] = file.new.path;
      }
    }
    return out;
  }
}

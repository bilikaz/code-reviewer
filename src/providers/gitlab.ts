// GitLab implementation of Provider. Plain fetch — no official SDK needed
// for the subset we use.
//
// Token needs:
//   - `api` scope to read/write MR comments and submit reviews
//   - `read_repository` scope to read diffs
//
// `baseUrl` defaults to https://gitlab.com/api/v4; self-hosted instances pass
// their own.

import type { Config } from "../ctx.ts";
import { BaseProvider } from "./base.ts";
import type { InlinePost, PRComment, PRMetadata, Provider } from "./types.ts";

type Api = (path: string, init?: RequestInit) => Promise<unknown>;

// Fetch wrapper owned by this provider — deliberately NOT shared with
// bitbucket.ts: the two wrappers look alike today only by coincidence, and
// the APIs will diverge (pagination, rate limits, auth). See docs/conventions/consolidation.md.
function makeApi(baseUrl: string, token: string): Api {
  return async (path, init) => {
    const resp = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`GitLab API ${resp.status}: ${text.slice(0, 1024)}`);
    }
    return resp.json() as Promise<unknown>;
  };
}

interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  author: { username: string };
  source_branch: string;
  target_branch: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string };
  web_url: string;
}

interface GitLabNote {
  id: number;
  author: { username: string };
  body: string;
  created_at: string;
  resolvable?: boolean;
  resolved?: boolean;
  position?: {
    old_path: string;
    new_path: string;
    old_line: number | null;
    new_line: number | null;
    position_type: string;
  };
  parent_id?: number;
  thread_id?: number;
}

export class GitLabProvider extends BaseProvider implements Provider {
  readonly name = "gitlab" as const;

  private constructor(
    private readonly api: Api,
    private readonly projectPath: string,    // {host}/{owner}/{repo}
    private readonly number: number,
    private readonly botLogin: string,
  ) {
    super();
  }

  static async create(config: Config): Promise<GitLabProvider> {
    const { url } = config.pr;
    const { token, baseUrl } = config.gitlab;
    if (!token) throw new Error("GitLabProvider: token required");
    // {host}/{owner}/{repo}/-/merge_requests/{n}
    const m = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/-\/merge_requests\/(\d+)/);
    if (!m) throw new Error(`GitLabProvider: not a GitLab MR URL: ${url}`);
    const api = makeApi((baseUrl || "https://gitlab.com/api/v4").replace(/\/$/, ""), token);
    const projectPath = `${m[1]!}/${m[2]!}/${m[3]!}`;
    const me = await api("/user") as { username: string };
    return new GitLabProvider(api, projectPath, parseInt(m[4]!, 10), me.username);
  }

  private mrPath(): string {
    return `/projects/${encodeURIComponent(this.projectPath)}/merge_requests/${this.number}`;
  }

  async getPRMetadata(): Promise<PRMetadata> {
    const mr = await this.api(this.mrPath()) as GitLabMR;
    return {
      title: mr.title,
      description: mr.description ?? "",
      author: mr.author.username,
      baseBranch: mr.target_branch,
      headBranch: mr.source_branch,
      baseSha: mr.diff_refs.base_sha,
      headSha: mr.diff_refs.head_sha,
      url: mr.web_url,
      state: mr.state === "merged" ? "merged" : (mr.state as "open" | "closed"),
    };
  }

  async getPRComments(): Promise<PRComment[]> {
    const out: PRComment[] = [];
    const notes = await this.api(`${this.mrPath()}/notes?per_page=100&sort=asc`) as GitLabNote[];
    for (const n of notes) {
      if (n.position) continue;
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
      const pos = n.position!;
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

  async postInlineComment(c: InlinePost): Promise<void> {
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

  async postSummaryComment(body: string): Promise<void> {
    await this.api(`${this.mrPath()}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async approve(summary?: string): Promise<void> {
    if (summary) await this.postSummaryComment(summary);
    await this.api(`${this.mrPath()}/approve`, { method: "POST" });
  }

  async reject(summary?: string): Promise<void> {
    // GitLab has no native request_changes action — only the comment lands.
    if (summary) await this.postSummaryComment(summary);
  }

  async resolveThread(threadId: string): Promise<void> {
    await this.api(`${this.mrPath()}/discussions/${threadId}/resolve`, { method: "PUT" });
  }

  async deleteComment(commentId: string, _kind: "issue" | "review"): Promise<void> {
    await this.api(`${this.mrPath()}/notes/${commentId}`, { method: "DELETE" });
  }

  // GitLab's changes API reports renames directly — richer than the base
  // class's git -M derivation.
  override async getRenames(_meta: PRMetadata): Promise<{ [oldPath: string]: string }> {
    const changes = await this.api(`${this.mrPath()}/changes`) as {
      changes?: { renamed_to?: string; renamed_from?: string; old_path?: string; new_path?: string }[];
    };
    const out: { [oldPath: string]: string } = {};
    for (const file of changes.changes ?? []) {
      if (file.renamed_to && file.renamed_from) {
        out[file.renamed_from] = file.renamed_to;
      } else if (file.old_path && file.new_path && file.old_path !== file.new_path) {
        out[file.old_path] = file.new_path;
      }
    }
    return out;
  }
}

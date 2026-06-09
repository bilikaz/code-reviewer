// GitHub implementation of VcsProvider. REST via @octokit/rest for the basic
// PR data and posting; GraphQL for review-thread resolution (the REST API
// doesn't expose `isResolved` or a resolve endpoint on review threads).
//
// Token needs:
//   - `pull-requests: write` to comment + submit reviews
//   - `contents: read` to read the diff
//   - (read:user) implied by getAuthenticated for non-Actions runs.

import { Octokit } from "@octokit/rest";

import type { Config } from "../ctx.ts";
import { gitChangedFiles, gitFileDiff, gitPotentialRenames } from "../lib/git.ts";
import type {
  ChangedFile,
  FileDiffOpts,
  InlinePost,
  PotentialRename,
  PRComment,
  PRMetadata,
  VcsProvider,
} from "./types.ts";

interface ThreadGql {
  id: string;
  isResolved: boolean;
  comments: { nodes: { databaseId: number | null }[] };
}

export class GitHubProvider implements VcsProvider {
  readonly name = "github" as const;

  private constructor(
    private readonly client: Octokit,
    private readonly owner: string,
    private readonly repo: string,
    private readonly number: number,
    private readonly botLogin: string,
  ) {}

  static async create(config: Config, octokit?: Octokit): Promise<GitHubProvider> {
    const { url } = config.pr;
    const { token } = config.github;
    if (!token) throw new Error("GitHubProvider: token required");
    const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) throw new Error(`GitHubProvider: not a GitHub PR URL: ${url}`);
    const client = octokit ?? new Octokit({ auth: token });
    // The "bot" identity must match whatever account actually authors the
    // comments, or the reconcile/verify step won't recognize its own prior
    // threads. Resolve it from the token via GET /user — correct for user tokens
    // and PATs, INCLUDING a user PAT used inside Actions. (The old
    // `GITHUB_ACTIONS` shortcut forced "github-actions[bot]" there, so under a
    // user token the comments came back classified "human" and reconcile got
    // skipped.) Only the default Actions GITHUB_TOKEN — an App installation
    // token — 403s on GET /user; fall back to the fixed bot login then.
    let botLogin: string;
    try {
      botLogin = (await client.users.getAuthenticated()).data.login;
    } catch {
      botLogin = "github-actions[bot]";
    }
    return new GitHubProvider(client, m[1]!, m[2]!, parseInt(m[3]!, 10), botLogin);
  }

  async getPRMetadata(): Promise<PRMetadata> {
    const { data } = await this.client.pulls.get({
      owner: this.owner, repo: this.repo, pull_number: this.number,
    });
    return {
      title: data.title,
      description: data.body ?? "",
      author: data.user?.login ?? "(unknown)",
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
      baseSha: data.base.sha,
      headSha: data.head.sha,
      url: data.html_url,
      state: data.merged ? "merged" : (data.state as "open" | "closed"),
    };
  }

  async getChangedFiles(meta: PRMetadata): Promise<ChangedFile[]> {
    return gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha });
  }

  async getPotentialRenames(meta: PRMetadata): Promise<PotentialRename[]> {
    return gitPotentialRenames({ baseSha: meta.baseSha, headSha: meta.headSha });
  }

  async getFileDiff(meta: PRMetadata, path: string, opts: FileDiffOpts): Promise<string> {
    return gitFileDiff({ baseSha: meta.baseSha, headSha: meta.headSha, path, context: opts.context });
  }

  async getPRComments(): Promise<PRComment[]> {
    const out: PRComment[] = [];

    const issueComments = await this.client.paginate(this.client.issues.listComments, {
      owner: this.owner, repo: this.repo, issue_number: this.number, per_page: 100,
    });
    for (const c of issueComments) {
      out.push({
        id: String(c.id),
        by: c.user?.login === this.botLogin ? "bot" : "human",
        author: c.user?.login ?? "(unknown)",
        body: c.body ?? "",
        createdAt: c.created_at,
      });
    }

    const threads = await this.loadReviewThreads();
    const reviewComments = await this.client.paginate(this.client.pulls.listReviewComments, {
      owner: this.owner, repo: this.repo, pull_number: this.number, per_page: 100,
    });
    for (const c of reviewComments) {
      const thread = threads.byCommentDbId.get(c.id);
      out.push({
        id: String(c.id),
        threadId: thread?.id,
        by: c.user?.login === this.botLogin ? "bot" : "human",
        author: c.user?.login ?? "(unknown)",
        body: c.body,
        createdAt: c.created_at,
        inline: c.line
          ? { path: c.path, line: c.line, side: c.side === "LEFT" ? "base" : "head" }
          : undefined,
        parentId: c.in_reply_to_id ? String(c.in_reply_to_id) : undefined,
        resolved: thread?.isResolved ?? false,
      });
    }
    return out;
  }

  async postInlineComment(c: InlinePost): Promise<void> {
    const meta = await this.getPRMetadata();
    await this.client.pulls.createReviewComment({
      owner: this.owner, repo: this.repo, pull_number: this.number,
      body: c.body, commit_id: meta.headSha,
      path: c.path, line: c.line, side: "RIGHT",
    });
  }

  async postSummaryComment(body: string): Promise<void> {
    await this.client.issues.createComment({
      owner: this.owner, repo: this.repo, issue_number: this.number, body,
    });
  }

  async approve(summary?: string): Promise<void> {
    // Bots don't formally approve on GitHub — the Actions token is blocked
    // from self-approval on public repos as a security guardrail, and even
    // automation accounts shouldn't carry that authority. Post the summary
    // as a COMMENT review when there's something to say; otherwise stay
    // silent (matches GitLab/Bitbucket behavior). The workflow's exit
    // code is the gate either way.
    if (!summary) return;
    await this.client.pulls.createReview({
      owner: this.owner, repo: this.repo, pull_number: this.number,
      event: "COMMENT",
      body: summary,
    });
  }

  async reject(summary?: string): Promise<void> {
    // REQUEST_CHANGES makes the verdict visible on the PR, so always post
    // it — even if there's no summary text (blocking findings live in
    // inline comments). GitHub 422s on empty body, hence the fallback.
    await this.client.pulls.createReview({
      owner: this.owner, repo: this.repo, pull_number: this.number,
      event: "REQUEST_CHANGES",
      body: summary || "Changes requested — see inline comments.",
    });
  }

  async resolveThread(threadId: string): Promise<void> {
    await this.client.graphql<{ resolveReviewThread: { thread: { id: string } } }>(
      `mutation($id: ID!) {
         resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
       }`,
      { id: threadId },
    );
  }

  async deleteComment(commentId: string, kind: "issue" | "review"): Promise<void> {
    const id = parseInt(commentId, 10);
    if (kind === "issue") {
      await this.client.issues.deleteComment({ owner: this.owner, repo: this.repo, comment_id: id });
    } else {
      await this.client.pulls.deleteReviewComment({ owner: this.owner, repo: this.repo, comment_id: id });
    }
  }

  async getRenames(meta: PRMetadata): Promise<{ [oldPath: string]: string }> {
    const resp = await this.client.repos.compareCommits({
      owner: this.owner, repo: this.repo, base: meta.baseSha, head: meta.headSha,
    });
    const out: { [oldPath: string]: string } = {};
    for (const file of resp.data.files ?? []) {
      if (file.status === "renamed" && file.filename && file.previous_filename) {
        out[file.previous_filename] = file.filename;
      }
    }
    return out;
  }

  private async loadReviewThreads(): Promise<{
    byCommentDbId: Map<number, { id: string; isResolved: boolean }>;
  }> {
    const byCommentDbId = new Map<number, { id: string; isResolved: boolean }>();
    let cursor: string | null = null;
    while (true) {
      const resp: {
        repository: { pullRequest: { reviewThreads: {
          nodes: ThreadGql[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        } } };
      } = await this.client.graphql(
        `query($owner:String!,$repo:String!,$n:Int!,$cursor:String) {
           repository(owner:$owner, name:$repo) {
             pullRequest(number:$n) {
               reviewThreads(first: 100, after: $cursor) {
                 pageInfo { hasNextPage endCursor }
                 nodes { id isResolved comments(first: 100) { nodes { databaseId } } }
               }
             }
           }
         }`,
        { owner: this.owner, repo: this.repo, n: this.number, cursor },
      );
      const page = resp.repository.pullRequest.reviewThreads;
      for (const t of page.nodes) {
        for (const c of t.comments.nodes) {
          if (c.databaseId != null) {
            byCommentDbId.set(c.databaseId, { id: t.id, isResolved: t.isResolved });
          }
        }
      }
      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
    }
    return { byCommentDbId };
  }
}

import type { ChangedFile, PotentialRename } from "../lib/git.ts";

// Git-derived wire shapes are defined where they're produced (lib/git.ts)
// and re-exported here so consumers keep importing them from the port
// (ADR-0009).
export type { ChangedFile, PotentialRename } from "../lib/git.ts";

export type ProviderKind = "github" | "gitlab" | "bitbucket" | "mock" | "local";

export interface PRMetadata {
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  baseSha: string;
  headSha: string;
  url: string;
  state: "open" | "closed" | "merged";
}

export interface PRComment {
  id: string;
  // For GitHub review threads, this is the GraphQL node id of the thread the
  // comment belongs to. Resolve/delete operations target this. For issue
  // comments and providers without a separate thread concept, equals `id`.
  threadId?: string;
  by: "bot" | "human";
  author: string;
  body: string;
  createdAt: string;
  inline?: { path: string; line: number; side: "head" | "base" };
  parentId?: string;
  resolved?: boolean;
}

export interface InlinePost {
  path: string;
  line: number;
  body: string;
  // Optional context. Real providers ignore it (severity isn't part of a VCS
  // comment); the local provider uses it to color console output.
  severity?: "info" | "warning" | "blocker";
}

export interface FileDiffOpts {
  context: number;
}

// Each provider stores its PR identity (owner/repo/number) and token at
// construction time via a `static create(config)` async factory. Methods
// don't take a ref parameter — the provider serves exactly one PR for its
// lifetime.
export interface Provider {
  readonly name: ProviderKind;

  getPRMetadata(): Promise<PRMetadata>;
  // List of files changed in the PR with rename detection.
  getChangedFiles(meta: PRMetadata): Promise<ChangedFile[]>;
  // Rename candidates below the confident threshold (30%–49% similarity).
  // Returned separately so fetch can log them as warnings without polluting
  // the canonical changed-files classification.
  getPotentialRenames(meta: PRMetadata): Promise<PotentialRename[]>;
  // Unified diff for one file with the given context width. Real providers
  // shell out to `git diff -U<context> base...head -- path` against the
  // local checkout; the mock provider computes from its fixture directories.
  getFileDiff(meta: PRMetadata, path: string, opts: FileDiffOpts): Promise<string>;
  getPRComments(): Promise<PRComment[]>;

  postInlineComment(c: InlinePost): Promise<void>;
  postSummaryComment(body: string): Promise<void>;
  // Semantic outcomes. Each method posts `summary` as a comment AND attempts
  // the formal participant action. Platform-specific degradation (GitHub
  // bots can't APPROVE, GitLab/Bitbucket have no native request_changes) is
  // handled inside the provider — callers don't need to know the rules.
  // Throws on hard failure; the caller's exit code is the gate.
  approve(summary?: string): Promise<void>;
  reject(summary?: string): Promise<void>;

  resolveThread(threadId: string): Promise<void>;
  deleteComment(commentId: string, kind: "issue" | "review"): Promise<void>;

  getRenames(meta: PRMetadata): Promise<{ [oldPath: string]: string }>;
}

// One bot inline finding awaiting action: the root comment of an unresolved
// inline thread authored by the bot. The pipeline gate (cli.ts), reconcile's
// candidate selection, and summarize's no-reconcile fallback all share this
// predicate — they must agree or the verdict drifts (ADR-0011).
export function isOpenBotThread(
  c: PRComment,
): c is PRComment & { inline: NonNullable<PRComment["inline"]> } {
  return c.by === "bot" && c.inline !== undefined && !c.resolved && !c.parentId;
}

// Dispatch helper: returns which provider's `create()` should handle a URL.
export function detectProvider(url: string): ProviderKind {
  if (/^mock:\/\//.test(url)) return "mock";
  if (/^local:\/\//.test(url)) return "local";
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) return "github";
  if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/-\/merge_requests\/\d+/.test(url)) return "gitlab";
  if (/^https?:\/\/bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/\d+/.test(url)) return "bitbucket";
  if (/^https?:\/\/[^/]+\/projects\/[^/]+\/repos\/[^/]+\/pull-requests\/\d+/.test(url)) return "bitbucket";
  throw new Error(`unsupported PR URL: ${url}`);
}

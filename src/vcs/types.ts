export type ProviderKind = "github" | "gitlab" | "bitbucket" | "mock";

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
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
}

export interface FileDiffOpts {
  context: number;
}

// Pairs git flagged as renames at a relaxed similarity threshold (30%–49%)
// — below the confident bar but worth surfacing so the operator can spot
// "this should have been a rename" cases (typically small files where git's
// score is penalized by per-file overhead).
export interface PotentialRename {
  oldPath: string;
  newPath: string;
  similarityPct: number;
}

// Each provider stores its PR identity (owner/repo/number) and token at
// construction time via a `static create(config)` async factory. Methods
// don't take a ref parameter — the provider serves exactly one PR for its
// lifetime.
export interface VcsProvider {
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

// Dispatch helper: returns which provider's `create()` should handle a URL.
export function detectProvider(url: string): ProviderKind {
  if (/^mock:\/\//.test(url)) return "mock";
  if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) return "github";
  if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/-\/merge_requests\/\d+/.test(url)) return "gitlab";
  if (/^https?:\/\/bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/\d+/.test(url)) return "bitbucket";
  if (/^https?:\/\/[^/]+\/projects\/[^/]+\/repos\/[^/]+\/pull-requests\/\d+/.test(url)) return "bitbucket";
  throw new Error(`unsupported PR URL: ${url}`);
}

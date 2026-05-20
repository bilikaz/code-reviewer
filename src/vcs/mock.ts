// Mock VCS provider. For tests + local debugging via `mock://<scenario>` URLs.
//
// Setup trick: instead of re-implementing diff/rename detection in TS, the
// mock spins up a throwaway local git repo:
//
//   1. Create a temp dir.
//   2. Copy tests/fixtures/<scenario>/old/ → repo, commit ("base").
//   3. Replace working tree with tests/fixtures/<scenario>/new/, commit ("head").
//   4. Chdir to the temp repo so stages' relative file reads resolve there.
//
// After setup, getChangedFiles / getFileDiff delegate to the same gitChanged-
// Files / gitFileDiff helpers the real providers use — no parallel diff
// algorithm to maintain, renames detected by `git -M` automatically.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

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

// ---- Fixture loading -----------------------------------------------------

interface FixtureConfig {
  metadata?: Partial<PRMetadata>;
  comments?: PRComment[];
}

type MockAction = "approve" | "reject";

function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "tests", "fixtures"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function loadFixtureConfig(scenarioPath: string): FixtureConfig {
  const p = join(scenarioPath, "config.yaml");
  if (!existsSync(p)) return {};
  try {
    return parseYaml(readFileSync(p, "utf-8")) as FixtureConfig;
  } catch (e) {
    console.warn(`mock: failed to parse ${p}: ${(e as Error).message}`);
    return {};
  }
}

// ---- Temp git repo setup ------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`mock: git ${args.join(" ")} failed (exit ${r.status}): ${(r.stderr || "").trim()}`);
  }
  return (r.stdout || "").trim();
}

function rmAllExceptGit(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    rmSync(join(dir, entry.name), { recursive: true, force: true });
  }
}

interface RepoSetup {
  cwd: string;
  baseSha: string;
  headSha: string;
}

function setupRepo(scenarioPath: string): RepoSetup {
  const cwd = mkdtempSync(join(tmpdir(), "reviewer-mock-"));

  git(cwd, "init", "-q", "--initial-branch=main");
  git(cwd, "config", "user.email", "mock@reviewer.local");
  git(cwd, "config", "user.name",  "mock");
  git(cwd, "config", "commit.gpgsign", "false");

  const oldDir = join(scenarioPath, "old");
  if (existsSync(oldDir)) cpSync(oldDir, cwd, { recursive: true });
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "-m", "base");
  const baseSha = git(cwd, "rev-parse", "HEAD");

  rmAllExceptGit(cwd);
  const newDir = join(scenarioPath, "new");
  if (existsSync(newDir)) cpSync(newDir, cwd, { recursive: true });
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "--allow-empty", "-m", "head");
  const headSha = git(cwd, "rev-parse", "HEAD");

  process.on("exit", () => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  return { cwd, baseSha, headSha };
}

// ---- Provider ------------------------------------------------------------

const DEFAULT_META: PRMetadata = {
  title: "Mock PR",
  description: "",
  author: "mock-author",
  baseBranch: "main",
  headBranch: "feature",
  baseSha: "",
  headSha: "",
  url: "mock://scenario",
  state: "open",
};

export class MockVcsProvider implements VcsProvider {
  readonly name: "mock" = "mock";

  private readonly repo: RepoSetup | null;
  private readonly fixture: FixtureConfig;

  // Side-effect logs for test assertions.
  private _postedInline:     Array<{ c: InlinePost }> = [];
  private _postedSummaries:  Array<{ body: string }> = [];
  private _resolvedThreads:  Array<{ threadId: string }> = [];
  private _deletedComments:  Array<{ commentId: string; kind: "issue" | "review" }> = [];
  private _verdicts:         Array<{ verdict: MockAction; summary?: string }> = [];

  private constructor(repo: RepoSetup | null, fixture: FixtureConfig) {
    this.repo = repo;
    this.fixture = fixture;
  }

  // Bare provider — no scenario, no git repo. For unit tests that drive a
  // single stage (e.g. summarize) with a hand-built StageState and only need
  // the side-effect recorders.
  static empty(fixture: FixtureConfig = {}): MockVcsProvider {
    return new MockVcsProvider(null, fixture);
  }

  static async create(config: Config): Promise<MockVcsProvider> {
    return MockVcsProvider.fromUrl(config.pr.url);
  }

  static fromUrl(url: string): MockVcsProvider {
    const m = url.match(/^mock:\/\/(.+)$/);
    if (!m) throw new Error(`Invalid mock URL: ${url}. Expected: mock://<scenario>`);
    const scenario = m[1]!;
    const scenarioPath = join(findProjectRoot(), "tests", "fixtures", scenario);
    if (!existsSync(scenarioPath)) {
      console.warn(`mock: scenario ${scenario} not found at ${scenarioPath}; provider has no fixture data`);
      return new MockVcsProvider(null, {});
    }
    const fixture = loadFixtureConfig(scenarioPath);
    const repo = setupRepo(scenarioPath);
    // Stages read changed files via relative paths; pin cwd to the temp repo
    // so existsSync / readFileSync resolve against the mock head tree.
    process.chdir(repo.cwd);
    return new MockVcsProvider(repo, fixture);
  }

  // ---- VcsProvider --------------------------------------------------------

  async getPRMetadata(): Promise<PRMetadata> {
    const fromFixture = this.fixture.metadata ?? {};
    return {
      ...DEFAULT_META,
      ...fromFixture,
      baseSha: this.repo?.baseSha ?? fromFixture.baseSha ?? "",
      headSha: this.repo?.headSha ?? fromFixture.headSha ?? "",
    };
  }

  async getChangedFiles(meta: PRMetadata): Promise<ChangedFile[]> {
    if (!this.repo) return [];
    return gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.repo.cwd });
  }

  async getPotentialRenames(meta: PRMetadata): Promise<PotentialRename[]> {
    if (!this.repo) return [];
    return gitPotentialRenames({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.repo.cwd });
  }

  async getFileDiff(meta: PRMetadata, path: string, opts: FileDiffOpts): Promise<string> {
    if (!this.repo) return "";
    return gitFileDiff({ baseSha: meta.baseSha, headSha: meta.headSha, path, context: opts.context, cwd: this.repo.cwd });
  }

  async getPRComments(): Promise<PRComment[]> {
    return (this.fixture.comments ?? []).map((c) => ({ ...c }));
  }

  async postInlineComment(c: InlinePost): Promise<void> {
    this._postedInline.push({ c: { ...c } });
  }
  async postSummaryComment(body: string): Promise<void> {
    this._postedSummaries.push({ body });
  }
  async approve(summary?: string): Promise<void> {
    this._verdicts.push({ verdict: "approve", summary });
  }
  async reject(summary?: string): Promise<void> {
    this._verdicts.push({ verdict: "reject", summary });
  }
  async resolveThread(threadId: string): Promise<void> {
    this._resolvedThreads.push({ threadId });
  }
  async deleteComment(commentId: string, kind: "issue" | "review"): Promise<void> {
    this._deletedComments.push({ commentId, kind });
  }
  // Renames come from git's -M detection in getChangedFiles; mock keeps this
  // method coherent with the others (callers use getChangedFiles directly).
  async getRenames(meta: PRMetadata): Promise<{ [oldPath: string]: string }> {
    if (!this.repo) return {};
    const changed = await gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.repo.cwd });
    const out: { [oldPath: string]: string } = {};
    for (const f of changed) {
      if (f.status === "renamed" && f.oldPath) out[f.oldPath] = f.path;
    }
    return out;
  }

  // ---- Accessors for test assertions -------------------------------------

  get cwd():               string | null { return this.repo?.cwd ?? null; }
  get postedInline():      ReadonlyArray<{ c: InlinePost }> { return this._postedInline; }
  get postedSummaries():   ReadonlyArray<{ body: string }> { return this._postedSummaries; }
  get resolvedThreads():   ReadonlyArray<{ threadId: string }> { return this._resolvedThreads; }
  get deletedComments():   ReadonlyArray<{ commentId: string; kind: "issue" | "review" }> { return this._deletedComments; }
  get verdicts():          ReadonlyArray<{ verdict: MockAction; summary?: string }> { return this._verdicts; }
}

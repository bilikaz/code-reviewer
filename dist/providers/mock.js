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
import { errorMessage } from "../lib/errors.js";
import { BaseProvider } from "./base.js";
function findProjectRoot() {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 10; i++) {
        if (existsSync(join(dir, "tests", "fixtures")))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
function loadFixtureConfig(scenarioPath) {
    const p = join(scenarioPath, "config.yaml");
    if (!existsSync(p))
        return {};
    try {
        return parseYaml(readFileSync(p, "utf-8"));
    }
    catch (e) {
        // console.warn (not the Logger port): the provider is constructed
        // before a logger exists, and this path is test-only — deliberate exception.
        console.warn(`mock: failed to parse ${p}: ${errorMessage(e)}`);
        return {};
    }
}
// ---- Temp git repo setup ------------------------------------------------
function git(cwd, ...args) {
    const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
    if (r.status !== 0) {
        throw new Error(`mock: git ${args.join(" ")} failed (exit ${r.status}): ${(r.stderr || "").trim()}`);
    }
    return (r.stdout || "").trim();
}
function rmAllExceptGit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".git")
            continue;
        rmSync(join(dir, entry.name), { recursive: true, force: true });
    }
}
function setupRepo(scenarioPath) {
    const cwd = mkdtempSync(join(tmpdir(), "reviewer-mock-"));
    git(cwd, "init", "-q", "--initial-branch=main");
    git(cwd, "config", "user.email", "mock@reviewer.local");
    git(cwd, "config", "user.name", "mock");
    git(cwd, "config", "commit.gpgsign", "false");
    const oldDir = join(scenarioPath, "old");
    if (existsSync(oldDir))
        cpSync(oldDir, cwd, { recursive: true });
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "base");
    const baseSha = git(cwd, "rev-parse", "HEAD");
    rmAllExceptGit(cwd);
    const newDir = join(scenarioPath, "new");
    if (existsSync(newDir))
        cpSync(newDir, cwd, { recursive: true });
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "head");
    const headSha = git(cwd, "rev-parse", "HEAD");
    process.on("exit", () => {
        try {
            rmSync(cwd, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    });
    return { cwd, baseSha, headSha };
}
// ---- Provider ------------------------------------------------------------
const DEFAULT_META = {
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
export class MockProvider extends BaseProvider {
    name = "mock";
    repo;
    fixture;
    // Side-effect logs for test assertions.
    _postedInline = [];
    _postedSummaries = [];
    _resolvedThreads = [];
    _deletedComments = [];
    _verdicts = [];
    constructor(repo, fixture) {
        super();
        this.repo = repo;
        this.gitCwd = repo?.cwd;
        this.fixture = fixture;
    }
    // Bare provider — no scenario, no git repo. For unit tests that drive a
    // single stage (e.g. summarize) with a hand-built StageState and only need
    // the side-effect recorders.
    static empty(fixture = {}) {
        return new MockProvider(null, fixture);
    }
    static async create(config) {
        return MockProvider.fromUrl(config.pr.url);
    }
    static fromUrl(url) {
        const m = url.match(/^mock:\/\/(.+)$/);
        if (!m)
            throw new Error(`Invalid mock URL: ${url}. Expected: mock://<scenario>`);
        const scenario = m[1];
        const scenarioPath = join(findProjectRoot(), "tests", "fixtures", scenario);
        if (!existsSync(scenarioPath)) {
            console.warn(`mock: scenario ${scenario} not found at ${scenarioPath}; provider has no fixture data`);
            return new MockProvider(null, {});
        }
        const fixture = loadFixtureConfig(scenarioPath);
        const repo = setupRepo(scenarioPath);
        // Stages read changed files via relative paths; pin cwd to the temp repo
        // so existsSync / readFileSync resolve against the mock head tree.
        process.chdir(repo.cwd);
        return new MockProvider(repo, fixture);
    }
    // ---- Provider --------------------------------------------------------
    async getPRMetadata() {
        const fromFixture = this.fixture.metadata ?? {};
        return {
            ...DEFAULT_META,
            ...fromFixture,
            baseSha: this.repo?.baseSha ?? fromFixture.baseSha ?? "",
            headSha: this.repo?.headSha ?? fromFixture.headSha ?? "",
        };
    }
    // Bare (`empty()`) mocks have no git repo — guard, then defer to the
    // base class's delegation against gitCwd.
    async getChangedFiles(meta) {
        if (!this.repo)
            return [];
        return super.getChangedFiles(meta);
    }
    async getPotentialRenames(meta) {
        if (!this.repo)
            return [];
        return super.getPotentialRenames(meta);
    }
    async getFileDiff(meta, path, opts) {
        if (!this.repo)
            return "";
        return super.getFileDiff(meta, path, opts);
    }
    async getRenames(meta) {
        if (!this.repo)
            return {};
        return super.getRenames(meta);
    }
    async getPRComments() {
        return (this.fixture.comments ?? []).map((c) => ({ ...c }));
    }
    async postInlineComment(c) {
        this._postedInline.push({ c: { ...c } });
    }
    async postSummaryComment(body) {
        this._postedSummaries.push({ body });
    }
    async approve(summary) {
        this._verdicts.push({ verdict: "approve", summary });
    }
    async reject(summary) {
        this._verdicts.push({ verdict: "reject", summary });
    }
    async resolveThread(threadId) {
        this._resolvedThreads.push({ threadId });
    }
    async deleteComment(commentId, kind) {
        this._deletedComments.push({ commentId, kind });
    }
    // ---- Accessors for test assertions -------------------------------------
    get cwd() { return this.repo?.cwd ?? null; }
    get postedInline() { return this._postedInline; }
    get postedSummaries() { return this._postedSummaries; }
    get resolvedThreads() { return this._resolvedThreads; }
    get deletedComments() { return this._deletedComments; }
    get verdicts() { return this._verdicts; }
}

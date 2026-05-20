// Local git invocation helper. Shared by VCS providers (GitHub/GitLab/
// Bitbucket) when they need to drive `git diff` against the checked-out
// consuming repo to produce per-file diffs with controlled context width.
//
// The consuming repo is expected to be a real git checkout with both base
// and head SHAs available locally.

import { spawn } from "node:child_process";

export interface ChangedFile {
  path:    string;
  status:  "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
}

interface GitDiffOpts {
  baseSha: string;
  headSha: string;
  path:    string;
  context: number;
  cwd?:    string;
}

export async function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd: cwd ?? process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    proc.stdout.on("data", (b: Buffer) => { out += b.toString("utf-8"); });
    proc.stderr.on("data", (b: Buffer) => { err += b.toString("utf-8"); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} exited ${code}: ${err.trim().slice(0, 1024)}`));
      } else {
        resolve(out);
      }
    });
    proc.on("error", (e) => reject(new Error(`failed to spawn git: ${e.message}`)));
  });
}

export async function gitFileDiff(opts: GitDiffOpts): Promise<string> {
  // Three-dot syntax: diff between merge-base(base,head) and head — matches
  // what GitHub/GitLab show on the PR.
  return runGit(
    ["diff", `-U${opts.context}`, `${opts.baseSha}...${opts.headSha}`, "--", opts.path],
    opts.cwd,
  );
}

export async function gitChangedFiles(args: { baseSha: string; headSha: string; cwd?: string }): Promise<ChangedFile[]> {
  // -M: rename detection at git's default 50% similarity. Deliberately
  // strict — if git isn't confident it's a rename, downstream treats the
  // comment as being on a deleted file (auto-addressed). Loosening the
  // threshold would misclassify refactors as renames and relocate bot
  // comments inappropriately. --name-status: "A\tpath" / "M\tpath" /
  // "D\tpath" / "R<score>\told\tnew".
  const raw = await runGit(
    ["diff", "-M", "--name-status", `${args.baseSha}...${args.headSha}`],
    args.cwd,
  );
  const out: ChangedFile[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0]!;
    if (code === "A") out.push({ path: parts[1]!, status: "added" });
    else if (code === "M") out.push({ path: parts[1]!, status: "modified" });
    else if (code === "D") out.push({ path: parts[1]!, status: "deleted" });
    else if (code.startsWith("R")) out.push({ path: parts[2]!, status: "renamed", oldPath: parts[1]! });
    // T (type change), C (copy), U (unmerged) — rare on PR diffs, skip.
  }
  return out;
}

// Scans for rename candidates git wasn't confident enough to flag at the
// default 50% threshold. Lowers the bar to 30% and reports pairs in that
// 30%–49% band. fetch surfaces these as warnings so an operator can spot
// "this should have been a rename" cases (typically small files where git's
// similarity score is unfairly penalized by per-file overhead).
export interface PotentialRename {
  oldPath: string;
  newPath: string;
  similarityPct: number;
}

export async function gitPotentialRenames(args: { baseSha: string; headSha: string; cwd?: string }): Promise<PotentialRename[]> {
  const raw = await runGit(
    ["diff", "-M30", "--name-status", `${args.baseSha}...${args.headSha}`],
    args.cwd,
  );
  const out: PotentialRename[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("R")) continue;
    const parts = line.split("\t");
    const head = parts[0]!;
    // R<score>\told\tnew
    const score = parseInt(head.slice(1), 10);
    if (!Number.isFinite(score) || score >= 50) continue; // ≥50 = confident, already handled
    out.push({ oldPath: parts[1]!, newPath: parts[2]!, similarityPct: score });
  }
  return out;
}

// Counts head-side lines represented in a unified diff (context + added).
// Used by fetch's coverage check to decide whether a "big" file is so
// extensively changed that it's worth showing in full.
export function headLinesCovered(diff: string): number {
  let inHunk = false;
  let count = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) { inHunk = true; continue; }
    if (!inHunk) continue;
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+") || line.startsWith(" ")) count++;
    // "-" lines are base-only; "\" are no-newline markers.
  }
  return count;
}

// New-side starting line of the first hunk in `diff`, or null if no hunk.
export function firstHunkNewLine(diff: string): number | null {
  const m = diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
  return m ? parseInt(m[1]!, 10) : null;
}

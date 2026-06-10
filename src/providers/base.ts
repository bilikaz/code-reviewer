// Shared plumbing for providers whose diff data comes from the local git
// checkout — which is all of them (ADR-0004). Subclasses inherit
// changed-files / per-file diffs / potential-rename scanning; `getRenames`
// defaults to git's confident (-M ≥50%) detection and is overridden by
// providers whose API exposes richer rename data.

import { gitChangedFiles, gitFileDiff, gitPotentialRenames } from "../lib/git.ts";
import type { ChangedFile, FileDiffOpts, PotentialRename, PRMetadata } from "./types.ts";

export abstract class BaseProvider {
  // Directory the git commands run in. undefined = process cwd (the real
  // providers run against the checked-out consuming repo). The mock provider
  // points this at its throwaway fixture repo.
  protected gitCwd?: string;

  async getChangedFiles(meta: PRMetadata): Promise<ChangedFile[]> {
    return gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.gitCwd });
  }

  async getPotentialRenames(meta: PRMetadata): Promise<PotentialRename[]> {
    return gitPotentialRenames({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.gitCwd });
  }

  async getFileDiff(meta: PRMetadata, path: string, opts: FileDiffOpts): Promise<string> {
    return gitFileDiff({
      baseSha: meta.baseSha,
      headSha: meta.headSha,
      path,
      context: opts.context,
      cwd: this.gitCwd,
    });
  }

  async getRenames(meta: PRMetadata): Promise<{ [oldPath: string]: string }> {
    const renames: { [oldPath: string]: string } = {};
    for (const f of await this.getChangedFiles(meta)) {
      if (f.status === "renamed" && f.oldPath) renames[f.oldPath] = f.path;
    }
    return renames;
  }
}

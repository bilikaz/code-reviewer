// Shared plumbing for providers whose diff data comes from the local git
// checkout — which is all of them (ADR-0004). Subclasses inherit
// changed-files / per-file diffs / potential-rename scanning; `getRenames`
// defaults to git's confident (-M ≥50%) detection and is overridden by
// providers whose API exposes richer rename data.
import { gitChangedFiles, gitFileDiff, gitPotentialRenames } from "../lib/git.js";
export class BaseProvider {
    // Directory the git commands run in. undefined = process cwd (the real
    // providers run against the checked-out consuming repo). The mock provider
    // points this at its throwaway fixture repo.
    gitCwd;
    async getChangedFiles(meta) {
        return gitChangedFiles({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.gitCwd });
    }
    async getPotentialRenames(meta) {
        return gitPotentialRenames({ baseSha: meta.baseSha, headSha: meta.headSha, cwd: this.gitCwd });
    }
    async getFileDiff(meta, path, opts) {
        return gitFileDiff({
            baseSha: meta.baseSha,
            headSha: meta.headSha,
            path,
            context: opts.context,
            cwd: this.gitCwd,
        });
    }
    async getRenames(meta) {
        const renames = {};
        for (const f of await this.getChangedFiles(meta)) {
            if (f.status === "renamed" && f.oldPath)
                renames[f.oldPath] = f.path;
        }
        return renames;
    }
}

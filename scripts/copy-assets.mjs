// Copy non-TS runtime assets (prompt.md, schema.json) from src/ into dist/,
// preserving directory structure. tsc only emits .js, but the stages load
// these files at runtime via readFileSync(resolve(HERE, ...)), so they must
// sit next to the compiled modules. Pure Node, no deps — runs cross-platform
// during `prepare` on any consumer's machine.

import { readdir, mkdir, copyFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";

const SRC = "src";
const DIST = "dist";
const ASSET = /\.(md|json)$/;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (ASSET.test(entry.name)) {
      const dest = join(DIST, relative(SRC, path));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(path, dest);
    }
  }
}

await walk(SRC);

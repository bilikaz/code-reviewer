// Standards loader — reads an index.yml + topic yamls under standardsRoot
// and renders them into a single block for the system prompt.
//
// Expected YAML shape:
//
//   # <standardsRoot>/index.yml
//   topics:
//     - file: security.yml
//       description: Secrets handling, input validation, injection prevention
//     - file: errors.yml
//       description: Error handling and propagation conventions
//
//   # <standardsRoot>/security.yml
//   rules:
//     - rule: Never interpolate user input directly into SQL strings.
//       example: |
//         // bad
//         db.query("SELECT * FROM users WHERE id = '" + userId + "'");
//         // good
//         db.query("SELECT * FROM users WHERE id = ?", [userId]);

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";

import type { Logger } from "../../logger/index.ts";

interface IndexEntry {
  file: string;
  description?: string;
}

interface Rule {
  rule: string;
  example?: string;
}

export interface LoadedTopic {
  description: string;
  rules: Rule[];
}

export interface LoadedStandards {
  topics: LoadedTopic[];
}

export function loadStandards(standardsRoot: string, log: Logger): LoadedStandards | null {
  if (!standardsRoot) return null;
  const root = resolve(process.cwd(), standardsRoot);
  const indexPath = join(root, "index.yml");
  if (!existsSync(indexPath)) {
    log.warn("standards.index_missing", { path: indexPath });
    return null;
  }
  const index = YAML.parse(readFileSync(indexPath, "utf-8")) as { topics?: IndexEntry[] } | null;
  if (!index?.topics) return { topics: [] };

  const topics: LoadedTopic[] = [];
  for (const entry of index.topics) {
    const filePath = join(root, entry.file);
    if (!existsSync(filePath)) {
      log.warn("standards.topic_missing", { file: entry.file });
      continue;
    }
    const parsed = YAML.parse(readFileSync(filePath, "utf-8")) as { rules?: Rule[] } | null;
    topics.push({
      description: entry.description ?? entry.file,
      rules: parsed?.rules ?? [],
    });
  }
  return { topics };
}

export function renderStandards(loaded: LoadedStandards | null): string {
  if (!loaded || loaded.topics.length === 0) return "";
  const lines: string[] = ["## Standards"];
  for (const t of loaded.topics) {
    lines.push(`\n### ${t.description}`);
    for (const r of t.rules) {
      lines.push(`- ${r.rule}`);
      if (r.example) {
        lines.push("  Example:");
        lines.push("  ```");
        lines.push(r.example.split("\n").map((l) => `  ${l}`).join("\n"));
        lines.push("  ```");
      }
    }
  }
  return lines.join("\n");
}

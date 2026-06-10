# Documentation

**Three layers, separated by lifecycle:**

| Layer | File(s) | Tense / lifecycle |
| --- | --- | --- |
| Map | `docs/ARCHITECTURE.md` | present tense; updated with the code; instance-specific |
| Rules | `docs/conventions/` | present tense; portable across projects; one topic per file |
| Decisions | `docs/adr/` | dated, immutable log; statuses Proposed → Accepted → Superseded |

The separation exists because mixing them corrupts both: rules buried in dated
records go stale-looking the moment a supersession lands; history rewritten into
"current state" docs loses the why. ADRs record *that and why* something was
adopted; conventions state *what the rule is now*; the map shows *where things are*.

**Rules.**

1. **Diagrams are Mermaid**, never ASCII art — they render on the hosting platform
   and in IDEs, and survive edits. Quote node labels containing `?`, `/`, or
   `<br/>` (flowchart parser traps).
2. **ADR hygiene:** one decision per ADR; supersede, don't rewrite (exception: a
   never-published doc set may be cleaned wholesale — history that was never shared
   isn't history). Convention adoption is one ADR pointing at `conventions/`, not a
   restatement.
3. **File-header comments.** Every source file opens with a comment stating its role
   and any non-obvious contract. Inline comments explain *why* and contract edges —
   never what the next line does, and never why a change was correct (that's
   reviewer-talk, noise after merge).
4. **Heuristics carry their rationale inline** — a threshold or magic decision in
   code states why that value, right where it's read.
5. **README is the operator's view** (install, run, configure); architecture detail
   links out to the map rather than duplicating it.

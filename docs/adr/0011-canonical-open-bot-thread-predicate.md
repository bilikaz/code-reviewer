# ADR-0011: Canonical predicate for open bot threads

Status: Accepted (2026-06-10)

## Context

The condition "unresolved bot inline root thread" —
`c.by === "bot" && c.inline && !c.resolved && !c.parentId` — was hand-written in three
places: `cli.ts` (`hasUnresolvedBotThreads`, decides whether reconcile runs),
`reconcile/index.ts` (`splitThreads`, selects judgment candidates), and
`summarize/index.ts` (fallback when reconcile didn't run). These three **must** agree:
if cli's copy says "no open threads" but summarize's copy finds one, the verdict is
wrong. Nothing enforced that agreement.

## Decision

Define it once where the comment shape lives:

```ts
// src/providers/types.ts
export function isOpenBotThread(c: PRComment): boolean;
```

All three sites call the predicate. Any future refinement (e.g. ignoring
bot-authored rename notices) is one edit that automatically keeps the pipeline's
gate, the judge's candidate set, and the verdict's fallback consistent.

## Consequences

- A semantic invariant ("what counts as an outstanding bot finding") is now code, not
  convention.
- Behavior-affecting tweaks to the predicate are visible in one diff hunk and one ADR
  amendment, instead of three scattered conditionals.

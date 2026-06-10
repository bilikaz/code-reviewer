# ADR-0000: What lands in this log (root of all roots)

Status: Accepted (2026-06-10)
Date: 2026-06-10

## Context

Adopted from the sibling harness repo (which itself adopted this repo's docs
structure). Its log started accumulating entries that aren't architecture — a
bug fix dressed up as a decision, a working-procedure write-up restating
`/CLAUDE.md`. Each seemed reasonable alone; together they dilute the log — a
reader can no longer assume an ADR marks a structural choice that future work
depends on. Every log sharing this structure needs the same gate.

## Decision

An entry belongs here only when **all three** hold:

1. **It's architectural** — it shapes the system's structure, contracts, or
   boundaries (a port, a layer rule, a wire format, a gating model).
2. **A real choice existed** — alternatives with trade-offs were on the table,
   and the why deserves to outlive the conversation that decided it.
3. **Future work depends on it** — someone building later acts differently
   because this was decided.

What does **not** land here, and where it goes instead:

- **Bug fixes** — correctness has no alternatives. The record is the commit
  message, the regression test, and (when the fix pins down a contract) a
  why-comment at the code and a line in the map.
- **Process and procedures** — how we work lives in `/CLAUDE.md`, which is
  updated directly when the workflow changes. No ADR mirrors it.
- **Restatements** — content that lives elsewhere is pointed at, never copied
  (the [documentation convention](../conventions/documentation.md) already says
  this for convention adoptions; it applies to everything).

## Consequences

- The log stays a trustworthy index of structural decisions; "is there an ADR?"
  remains a meaningful question.
- Some genuinely useful records live only in commits, tests, and CLAUDE.md —
  acceptable, because each has a defined home and the map links the layers.
- This ADR is numbered 0000 because it governs the log itself; entries predating
  it were grandfathered without re-review.

# Consolidation: essential vs. incidental duplication

**Rule.** Extract shared code only when at least one of these holds; otherwise leave
the copies with their owners.

1. **Essential duplication** — the copies must stay in sync *for correctness*;
   divergence is a bug, not an evolution. (A scope-join format every log sink must
   produce identically; a predicate three call sites must agree on or a verdict goes
   wrong; a prompt envelope two pipeline stages must emit identically.)
2. **Universal sharing** — all (or all-but-justified-exceptions) of the sites share
   it, and the shared concept is stable.

Do **not** extract *incidental* duplication — code that looks alike today because
both instances are currently simple, with no requirement to stay alike. Two REST
wrappers that differ only in an auth header owe each other nothing: pagination,
rate limits, and auth refresh will diverge per service.

## The failure mode this prevents

A shared helper extracted from a minority of sites (the "2 of 8" case) has two
futures once one consumer's needs change: it grows option flags for every variant,
or the consumer forks away and orphans a "shared" module with a single user. Both
outcomes are worse than the duplicated lines were.

## How to apply

- Before extracting, ask: *must* these stay identical, or do they merely *happen* to
  be identical? Only the first justifies coupling.
- Tolerated duplication gets a comment at the site marking it deliberate (and
  pointing at this rule), so a future cleanup pass doesn't re-couple it.
- Revisit when a third consumer appears with the same needs (rule of three) — and
  then re-check criterion 1, not just the count.
- The same logic governs types — see [types-placement.md](types-placement.md):
  shared-by-many promotes, used-by-one stays local.

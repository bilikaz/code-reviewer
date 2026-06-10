# ADR-0012: Shared fragment constants for summary-comment detection

Status: Accepted (2026-06-10)

## Context

`summarize` deletes its own stale summary comments from previous runs before posting
a fresh one. Detection (`isPriorSummary`) matched on a list of literal fragments
(`SUMMARY_FRAGMENTS`) while construction (`buildSummary`) embedded the same phrases
as separate string literals. Nothing tied the two together: rewording a summary line
would silently break deletion, and old summaries would pile up on long-lived PRs —
a drift bug waiting in the gap between two literals.

## Decision

Each summary block type gets one exported-nowhere module constant
(`FRAG_UNADDRESSED`, `FRAG_NO_SOURCE`, `FRAG_INFO`); `buildSummary` interpolates the
constant into the text it posts, and `SUMMARY_FRAGMENTS` (the detector's list) is
built from the same constants. Construction and detection can no longer disagree.

A content-invisible marker (e.g. an HTML comment `<!-- reviewer:summary -->`) was
considered and deferred: it is the more robust scheme, but switching detection to it
would orphan summaries posted by already-deployed versions. Fragment constants fix
the drift risk with zero migration. If the marker is ever adopted, detection must
keep matching the legacy fragments for at least one release.

## Consequences

- Rewording a summary block is a one-constant edit that keeps deletion working.
- The coupling is now visible in the code's shape instead of being tribal knowledge.

# ADR-0007: Snippet anchoring instead of LLM line numbers

Status: Accepted (2026-06-10)

## Context

Inline comments need a `path:line` anchor. LLMs reliably *quote* source but
unreliably *count* lines — asking for line numbers yields confidently wrong anchors,
and unified-diff line bookkeeping makes it worse.

## Decision

The review schema asks for a verbatim **single-line** `snippet` (plus optional
single-line `context_before` / `context_after` for disambiguation). The harness
(`stages/review/index.ts`) does the line math: normalize leading whitespace, find all
matches in the head-side file, disambiguate with context, and post at the unique
match.

Degradation is explicit and visible:

- File doesn't exist on head → top-level summary comment wrapping the snippet with a
  banner explaining the anchor failure.
- Snippet not uniquely located → inline comment at line 1 with the same banner.

Single-line snippets are mandated in the schema because multi-line blocks both anchor
worse and break JSON escaping more often.

## Consequences

- Anchors are correct whenever the model quotes correctly, which is its strong suit.
- Unanchorable findings are still delivered (never silently dropped), marked as such.
- The matcher is whitespace-lenient at line heads only; pathological files with many
  identical lines may fall back to line 1 — accepted trade-off.

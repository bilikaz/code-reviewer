# ADR-0013: Adopt the shared conventions set

Status: Accepted (2026-06-10)

## Context

A full-codebase pattern review settled a set of engineering rules — naming, type
placement, consolidation thresholds, error handling, configuration, logging,
testing, documentation. The rules are project-agnostic and intended for reuse in
other repos (and eventually as machine-readable standards for the reviewer's own
`standardsRoot` input). Embedding them in dated ADR prose made them hard to reuse
and mixed living rules into an immutable log.

## Decision

The rules live in [docs/conventions/](../conventions/) — one topic per file, stated
without reference to this codebase wherever possible. This ADR adopts the whole set
for this repository:

[naming](../conventions/naming.md) ·
[types-placement](../conventions/types-placement.md) ·
[consolidation](../conventions/consolidation.md) ·
[error-handling](../conventions/error-handling.md) ·
[configuration](../conventions/configuration.md) ·
[logging](../conventions/logging.md) ·
[testing](../conventions/testing.md) ·
[documentation](../conventions/documentation.md)

Repo-specific tolerated exceptions under those rules:

- `providers/local.ts` reads TTY/`NO_COLOR` directly — presentation, not config
  (configuration.md's stated exception).
- `providers/mock.ts` warns via `console` — constructed before a logger exists,
  test-only.
- `providers/gitlab.ts` / `providers/bitbucket.ts` each own a private `makeApi`
  wrapper — deliberate duplication per consolidation.md.
- `logger/index.ts` is a barrel whose contract sits in `logger/types.ts` — aligned
  with naming.md rule 5.

## Consequences

- Convention changes edit one topic file; this ADR stays valid as the adoption
  record.
- Other projects copy `docs/conventions/` and write their own one-page adoption
  ADR; deviations are recorded in the adopting repo, never by editing the shared
  rule.

# ADR-0004: BaseProvider — shared local-git plumbing for all providers

Status: Accepted (2026-06-10)

## Context

All five providers implement `getChangedFiles`, `getPotentialRenames`, and
`getFileDiff` as byte-identical delegations to `lib/git.ts` (the mock adds a `cwd`
and a null-repo guard). On top of that, `LocalProvider.getRenames` and
`MockProvider.getRenames` contained the same derive-renames-from-changed-files
loop. That's ~20 copy-pasted methods whose only purpose is plumbing — every new
provider would copy them again, and a fix (e.g. a new diff flag) would need five
edits.

## Decision

Introduce `src/providers/base.ts` with an abstract `BaseProvider`:

- Implements `getChangedFiles` / `getPotentialRenames` / `getFileDiff` once,
  delegating to `lib/git.ts` against `this.gitCwd` (a `protected` field, `undefined` =
  process cwd; the mock sets its temp repo path).
- Implements a default `getRenames` derived from `getChangedFiles` (git `-M`
  detection). Providers whose API gives richer rename data (GitHub compare, GitLab
  changes, Bitbucket diffstat) **override** it.
- All five providers `extend BaseProvider implements Provider`. The mock keeps
  thin guard overrides (`if (!this.repo) return []` then `super.…`) because a bare
  mock (`MockProvider.empty()`) has no repo by design.

Inheritance is justified here (vs. composition) because the methods are part of the
same port the classes already implement, the base carries no state beyond `gitCwd`,
and the hierarchy is exactly one level deep. This is a "shared adapter plumbing" base,
not a framework.

## Consequences

- Diff semantics are guaranteed identical across providers — there is now only one
  implementation to be identical to.
- A new provider gets diff plumbing for free; it implements only the genuinely
  platform-specific surface (metadata, comments, writes, verdicts).
- The mock's guards make the "no repo" mode explicit instead of being interleaved
  with the delegation logic.

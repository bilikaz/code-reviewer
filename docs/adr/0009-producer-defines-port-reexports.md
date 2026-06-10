# ADR-0009: Wire shapes — producer defines, the port re-exports

Status: Accepted (2026-06-10)

## Context

`ChangedFile` and `PotentialRename` were each defined **twice**, structurally
identically: in `src/lib/git.ts` (the producer of the values) and again in
`src/providers/types.ts` (the port that exposes them). TypeScript's structural typing made
this compile, which is exactly the danger — the copies could drift silently, and a
reader can't tell which one is canonical.

## Decision

A wire shape is defined **once, in the module that produces it**, and ports that
expose it **re-export** the type rather than re-declaring it.

Applied: `ChangedFile` and `PotentialRename` are defined in `lib/git.ts` (where the
parsing that creates them lives, including the field-by-field doc comments) and
re-exported from `providers/types.ts` so provider/stage code keeps importing them from the
port unchanged.

Dependency direction stays clean: `lib/` knows nothing about `providers/`; `providers/` builds on
`lib/`.

## Consequences

- One place to change a shape; impossible drift.
- Import sites are untouched — the port remains the public face.
- Rule of thumb for future types: producer defines, port re-exports, consumers import
  from the port.

# ADR-0001: Ctx dependency-injection container and env isolation

Status: Accepted (2026-06-10)

## Context

The pipeline needs three dependencies everywhere: typed configuration, the VCS
provider, and a logger. Alternatives were module-level singletons (hidden coupling,
hard to test), per-module env reads (untyped, scattered), or a DI framework (overkill
for a CLI of this size).

## Decision

A single `Ctx { config, provider, logger }` object is built once in `buildCtx()` at CLI
entry and passed explicitly as the first argument to every stage and to `callLLM`.

`process.env` is read in exactly one function — `loadConfig()` in `src/ctx.ts`. All
downstream code consumes the typed `Config`. Defaults live next to the loader
(`REVIEW_DEFAULTS`). CLI flags arrive as a `CliOverrides` object and win over env.

Tests construct a `Ctx` through the same `buildCtx`, overriding only what they need
(`logger`, `review` config) — no monkey-patching, no special test wiring inside
production code.

## Consequences

- Any function's dependencies are visible in its signature; nothing reaches around the
  container.
- Adding a setting = one typed field + default + (optionally) one env read in
  `loadConfig`. Grep for `process.env` outside `ctx.ts` should return nothing
  (the `NO_COLOR`/TTY check in the local provider's console styling is the one
  tolerated exception — it is presentation, not configuration).
- Per-provider credential validation happens at load time with actionable messages,
  so misconfiguration fails before any network call.

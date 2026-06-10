# ADR-0008: Logger port with scoped children and a stream channel

Status: Accepted (2026-06-10)

## Context

The reviewer runs in CI where logs are the only observability, and in tests where
log events are assertion targets. LLM token streams should appear live in CI but
would pollute structured sinks.

## Decision

A small `Logger` interface (`src/logger/types.ts`): four leveled methods taking
`(event, data?)`, a `child(scope)` deriving a scoped logger (`fetch`, `review.post`,
…), and a separate `stream(chunk)` channel for raw LLM text that structured sinks may
ignore.

Two sinks: `ConsoleLogger` (pretty, indented, stderr — keeps stdout clean for the
local provider's review output) and `MemoryLogger` (records `LogEntry[]` for tests).

Event names are dot-scoped snake_case (`llm.heal`, `anchor.unresolved`,
`potential_rename.auto_address`); payload is a flat data object — no string
interpolation into messages.

## Consequences

- Tests assert on events structurally instead of regexing console text.
- Swapping/adding sinks (e.g. JSON-lines for log aggregation) touches only `logger/`.
- Stage code reads as instrumented logic: `log.info("done", {...})` with the scope
  carried by the child.

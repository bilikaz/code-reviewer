# ADR-0005: LLM client loop with tool execution and schema healing

Status: Accepted (2026-06-10)

## Context

Stages need structured (JSON-schema-conforming) output from arbitrary
OpenAI-compatible endpoints, including small self-hosted models that emit malformed
JSON, wrap output in fences, or need several tool calls before answering. The
endpoint may not support native structured output or tool streaming reliably.

## Decision

`callLLM` (`src/llm/client.ts`) is the only path from a stage to the model. Shared shapes (wire messages, `Section`, `LLMResult`) live in `llm/types.ts`. Layers:

- `transport.ts` — the wire, both directions: `send` (HTTP POST returning the raw `Response`), and `receive` — an SSE accumulator that reassembles streamed deltas (including fragmented tool-call arguments) into a non-streaming-shaped message, mirroring raw text to the logger's `stream()` channel so CI shows output live.
- `client.ts` — the consumer API: `callLLM` (the loop: while the model returns `tool_calls`, execute locally and feed
  results back; on final text, extract JSON (fenced block → whole text → longest
  parsing-span salvage), validate with ajv against the stage's schema; on failure
  append the bad output plus a failure-specific heal prompt and retry up to
  `healRetries`. Malformed-JSON and schema-mismatch get different heal instructions
  because the fixes differ. Exhaustion throws `LLMValidationError`.

Tools follow a registry pattern (`llm/tools/`): each tool is a `{ schema, execute }`
object in its own file, listed once in `tools/index.ts`. Tool errors are written for
the model — they state what was received and what to do next, because weak models loop
on terse errors. Tool output is capped (64 KB) before being returned.

## Consequences

- Stages stay declarative: sections in, validated typed object out, usage/heal/tool
  counts attached for metrics.
- Works against any OpenAI-compatible endpoint with no per-vendor branches; the price
  is maintaining the salvage/heal machinery ourselves.
- Adding a tool = one file + one array entry; the dispatcher and conventions are
  fixed.

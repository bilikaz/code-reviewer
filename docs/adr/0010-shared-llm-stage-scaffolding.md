# ADR-0010: Shared scaffolding for LLM-using stages

Status: Accepted (2026-06-10)

## Context

`stages/review/index.ts` and `stages/reconcile/index.ts` each repeated, with small
variations:

- the prompt-asset loading triple (`readFileSync` of `prompt.md`, `schema.json`,
  `JSON.parse`),
- their own `SLOT` tag table (overlapping keys, same values),
- assembly of system sections (prompt → output_schema → project_context →
  rendering_context) and base user sections (pr_metadata → pr_diff → pr_comments),
- construction of the post-LLM `StageMetric` from an `LLMResult`.

A third LLM stage would copy all four again. Drift had already begun (slot tables
diverged by one key each).

## Decision

Grow `src/stages/shared.ts` (already the home for cross-stage LLM helpers) with:

```ts
loadPromptAssets(dir)         // → { prompt, schemaText, schema }
SLOT                          // single tag table for all stages
baseSystemSections(prompt, schemaText, state, opts?)  // + optional checklist slot
baseUserSections(state, comments)                     // meta + diff + comments
llmStageMetric(stage, t0, result)                     // tokens/heal/tool metric
```

Stages keep full control: helpers return arrays the stage may append to (review adds
`<thread_decisions>`; reconcile passes a filtered comment set). The helpers encode
*order and presence rules* (empty sections omitted), not stage policy.

## Consequences

- A new LLM stage is its prompt, its schema, and its policy code — no scaffolding.
- Section order and slot naming can no longer drift between stages.
- `stages/shared.ts` is the single place to evolve the prompt envelope (e.g. adding a
  global slot) — one edit, all stages.

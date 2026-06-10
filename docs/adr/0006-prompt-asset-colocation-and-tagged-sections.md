# ADR-0006: Prompt/schema colocation and tagged prompt sections

Status: Accepted (2026-06-10)

## Context

Each LLM stage has a substantial prompt and a JSON output schema. Embedding them as TS
template strings makes them unreviewable and untestable as documents; a central
`prompts/` folder separates them from the code that fills their slots.

## Decision

A stage's LLM contract lives next to its code: `src/stages/<stage>/prompt.md` and
`schema.json`, loaded at module init and shipped to `dist/` by
`scripts/copy-assets.mjs`. The schema text is also injected into the prompt as
`<output_schema>`, so the instructions and the validator can never disagree.

Dynamic data is injected as XML-tagged sections (`Section { tag, content }`),
serialized in order with empty sections omitted. Tag names are declared in the shared
`SLOT` table (`stages/shared.ts`); the prompt documents every tag it may receive.

## Consequences

- Prompt changes are reviewable diffs of a markdown file, side by side with the code
  that populates its slots.
- The model always sees the same schema ajv validates against.
- Build must copy non-TS assets (handled once in `copy-assets.mjs`); module-init file
  reads mean a missing asset fails fast at import time.

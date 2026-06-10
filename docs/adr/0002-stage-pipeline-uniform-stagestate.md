# ADR-0002: Stage pipeline with a uniform StageState

Status: Accepted (2026-06-10)

## Context

The reviewer is a sequence of phases (fetch → reconcile → review → summarize) that
must also be runnable individually as subcommands, and whose intermediate results
(findings, decisions, metrics) need to flow forward without stages knowing about each
other.

## Decision

Every stage is a single async function with a uniform signature:

```ts
runX(ctx: Ctx, state: StageState): Promise<StageState>   // runFetch takes only ctx
```

`StageState` (in `src/stages/types.ts`) is the pipeline's entire shared vocabulary:

- **Additive outputs.** Optional fields (`decisions`, `findings`, `verdict`) are each
  set once, by exactly one producing stage. Consumers treat absence as "that stage
  didn't run" and degrade explicitly (e.g. summarize falls back to raw comments when
  `decisions` is undefined).
- **Spread-and-extend returns.** Stages return
  `{ ...state, <field>, metrics: [...state.metrics, metric] }`; they don't mutate the
  incoming object. (Interior collections like `comments` may be refreshed by
  reassignment, never by splicing the caller's array.)
- **Uniform telemetry.** Each stage appends one `StageMetric` — duration, optional
  token usage / heal attempts / tool calls / `skipped`.

Sequencing policy lives only in `cli.ts` (e.g. reconcile runs only when unresolved bot
threads exist). Stages never call each other.

## Consequences

- New stages slot in without touching existing ones; subcommands are trivial
  compositions.
- Tests can drive any stage with a hand-built `StageState` (see
  `tests/e2e/summarize.test.ts`).
- The cost is a wide state type; discipline required: a field's producer must stay
  unique, and `stages/types.ts` is the only place to grow the shape.

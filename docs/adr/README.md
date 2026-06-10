# Architecture Decision Records

Dated, immutable decision log. Format `NNNN-title.md`; statuses
Proposed → Accepted → Superseded. Current-state rules live in
[../conventions/](../conventions/); the system map in
[../ARCHITECTURE.md](../ARCHITECTURE.md).

| # | Decision |
| --- | --- |
| [0001](0001-ctx-dependency-injection-and-env-isolation.md) | Ctx DI container; `process.env` read only in `loadConfig` |
| [0002](0002-stage-pipeline-uniform-stagestate.md) | Stage pipeline with uniform `StageState` |
| [0003](0003-provider-port-with-static-async-factories.md) | `Provider` port, static async factories, semantic verdict ops |
| [0004](0004-base-provider-shared-git-plumbing.md) | `BaseProvider`: all diffs from local git, shared plumbing |
| [0005](0005-llm-client-loop-with-schema-healing.md) | LLM client loop: tools, JSON salvage, schema healing |
| [0006](0006-prompt-asset-colocation-and-tagged-sections.md) | Prompt/schema colocated per stage; tagged prompt sections |
| [0007](0007-snippet-anchoring-over-line-numbers.md) | Snippet anchoring instead of LLM line numbers |
| [0008](0008-logger-port-with-scoped-children.md) | Logger port with scoped children + stream channel |
| [0009](0009-producer-defines-port-reexports.md) | Wire shapes defined by producer, re-exported by the port |
| [0010](0010-shared-llm-stage-scaffolding.md) | Shared LLM-stage scaffolding (assets, slots, sections, metrics) |
| [0011](0011-canonical-open-bot-thread-predicate.md) | Canonical `isOpenBotThread` predicate |
| [0012](0012-summary-comment-fragment-constants.md) | Shared fragment constants for summary detection |
| [0013](0013-adopt-shared-conventions.md) | Adopt `docs/conventions/` (naming, types placement, consolidation, errors, config, logging, testing, docs) |

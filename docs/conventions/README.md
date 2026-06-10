# Conventions

Portable engineering rules — deliberately **project-agnostic** so they can be copied
into any repo (or ingested into a standards knowledgebase). Each file is one topic:
the rule, why it exists, and how to apply it, with examples.

This repo's instance-specific documentation lives in
[../ARCHITECTURE.md](../ARCHITECTURE.md); the dated decision log in [../adr/](../adr/)
(ADR-0013 adopts this folder by reference).

| Topic | Rule in one line |
| --- | --- |
| [naming.md](naming.md) | Name modules and types by role, not implementation; the bells test gates every name |
| [types-placement.md](types-placement.md) | `types.ts` holds vocabulary (promotion test: 2+ importers / boundary / family); `shared.ts` holds cross-cutting helpers; everything else colocates |
| [consolidation.md](consolidation.md) | Extract only essential duplication or near-universal sharing; 2-of-N look-alikes stay duplicated |
| [error-handling.md](error-handling.md) | Normalize unknown throws; context-prefixed messages; per-item catch in batches |
| [configuration.md](configuration.md) | One env read point; typed config; exported defaults; fail fast with actionable hints |
| [logging.md](logging.md) | Structured events with dot-scoped children; data objects, never interpolation |
| [testing.md](testing.md) | Mock at the port with side-effect recorders; real engines; structural assertions |
| [documentation.md](documentation.md) | Three doc layers (map / conventions / ADRs); Mermaid for diagrams; why-comments |
| [i18n.md](i18n.md) | Every user-facing string through `t()`; locale files stay key-for-key; constants store keys |
| [react.md](react.md) | Named function components; hooks-only state access; stable list keys; no floating rejections |
| [constants-and-identifiers.md](constants-and-identifiers.md) | Behavioral literals are named; one id generator (seeds are not ids); namespaced persisted keys |

The UI-layer topics (i18n, react, constants-and-identifiers) were contributed by
the harness project (its ADR-0011) — this CLI repo doesn't exercise them, but
they ship with the set so any UI project adopting it gets them.

## Adopting in a new project

Copy the folder, delete topics that don't apply, add an ADR in the target repo
recording the adoption. Rules here are stated without reference to this codebase's
modules wherever possible; examples cite generic shapes. When a project must deviate,
record the deviation in that project's ADR — don't edit the convention to fit.

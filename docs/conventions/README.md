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

## Adopting in a new project

Copy the folder, delete topics that don't apply, add an ADR in the target repo
recording the adoption. Rules here are stated without reference to this codebase's
modules wherever possible; examples cite generic shapes. When a project must deviate,
record the deviation in that project's ADR — don't edit the convention to fit.

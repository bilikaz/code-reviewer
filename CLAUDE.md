# How we work

This repo documents itself in three layers (see [docs/conventions/documentation.md](docs/conventions/documentation.md)):

- **Map** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): where things are, present tense.
- **Rules** — [docs/conventions/](docs/conventions/): portable engineering rules, one topic per file.
- **Decisions** — [docs/adr/](docs/adr/): dated decision log, Proposed → Accepted → Superseded.

## Before starting work

Check the current branch first. Starting from `main`/`master` is the normal case
(a feature branch gets created at commit time). On any other branch, ask the user
whether working on it is intended — they may have forgotten to switch back after
a merge.

Read the docs: ARCHITECTURE.md for the area you're touching, the conventions
index ([docs/conventions/README.md](docs/conventions/README.md)), and any ADRs near
your change ([docs/adr/README.md](docs/adr/README.md)). Subagents get the same
instruction — point them at the specific files relevant to their task.

## While working

Build aligned with what is already settled: Accepted ADRs and the conventions as
written are binding. Don't invent a new pattern where a documented one fits, and
don't update the docs mid-session — note discoveries and deviations as you go and
carry them to the end-of-session step.

## Settle, then move

When a question, objection, or correction is raised — about code or docs — the
debate comes first and the edits come after. Don't touch files while a decision
is still open; discuss until it's settled or the user explicitly says go. This
applies symmetrically: code changes wait for settled decisions, doc updates wait
for finished debates (or the user's "time to write docs" signal). Nothing is
marked Accepted until the user has actually read and confirmed it.

## When the user says it's time to write docs

This step runs only on the user's signal, at the end of a session:

1. **Update the map** — ARCHITECTURE.md reflects the code as it now is.
2. **Write new ADRs** for decisions made this session — status **Proposed**, one
   decision per file, added to the ADR README index. Supersede, don't rewrite.
   Gate every candidate through [ADR-0000](docs/adr/0000-adr-scope.md):
   architectural decisions only — bug fixes don't get ADRs (commit message +
   regression test + why-comment), and process changes amend this file instead.
3. **Add or amend conventions** for patterns discovered this session (new topic
   file, or an addition to an existing one).
4. **Ask the user to confirm** the new ADRs and conventions. Confirmed → mark
   Accepted. Corrected → settle the corrected version, mark it Accepted, and apply
   it to the session's work so code and docs agree.

The distinction that makes this work: existing docs are **settled** — follow them
without debate, fast. New ADRs and conventions are **fluid** — drafted from what
the session discovered, and only become settled once the user confirms them. Next
session (and every subagent) then starts from the upgraded baseline.

## After everything is agreed

Commit and push the session's work:

- On `main`/`master`: create a new feature branch for the session's work first.
- On any other branch: stay on it — it's already the feature branch.
- Commit all the work (code + docs), then push with `./push.sh <branch-name>`
  (plain `git push` fails here — the SSH key isn't in the default agent).

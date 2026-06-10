# Constants and identifiers

**Rule.** A value that changes behavior gets a name; a value that identifies an
entity comes from one generator; a value that persists gets a namespaced key.
Unnamed literals are where behavior hides.

## Rules

1. **Behavioral literals are named.** Any number that changes what the program
   does — timeouts, poll intervals, retry counts, token budgets, size caps,
   window minimums — is a named `UPPER_SNAKE` module-level const next to its
   use site (`GREP_TIMEOUT_MS`, `OUTPUT_CAP`, `MAX_HEAL_ATTEMPTS`). The name
   states the unit (`_MS`, `_BYTES`) when one exists; the comment states why
   that value (see documentation.md — heuristics carry their rationale inline).
2. **Presentation literals stay inline.** Pixel sizes, spacing classes, icon
   dimensions — naming them adds indirection without meaning. The test: would a
   different value change *behavior* or just *looks*?
3. **One id generator.** Entity and call ids come from `crypto.randomUUID()`
   (or the platform's single equivalent) — never `Math.random()`, timestamps,
   or counters for identity. Mixed generators mean mixed collision properties
   and unsearchable id formats.
4. **Seeds are not ids.** A numeric value fed to a generator *as randomness*
   (an RNG seed for image/video generation) is not an identifier — it may use
   `Math.random()` and stays numeric. Mark it as a seed in name and comment so
   a cleanup pass doesn't "fix" it into a UUID.
5. **Persisted keys are namespaced and named.** Every localStorage/IndexedDB/
   file-cache key lives under one app prefix (`<app>:<feature>`) and is a named
   module-level constant, never an inline string. The prefix makes the app's
   total persisted footprint greppable and prevents collisions with anything
   else sharing the origin; the constant makes renames a one-line migration
   site instead of a scavenger hunt.

## Why

Inline literals are invisible at review time and unfindable at debug time. The
naming cost is one line; the payoff is that grep answers "what are this app's
timeouts / keys / budgets" instead of a code-reading session.

# Testing

**Rules.**

1. **Mock at the port, record side effects.** The test double implements the same
   port as real adapters and records every write (`postedInline`, `verdicts`, …) for
   assertions. Don't stub internals; swap the adapter.
2. **Use the real engine where one exists.** Don't reimplement diff/rename logic (or
   any engine) in the mock — drive the real tool against fixture data (e.g. build a
   throwaway git repo from `old/` + `new/` trees and let `git -M` do rename
   detection). The mock fakes the *destination*, not the *mechanics*.
3. **Structural assertions over text matching.** Assert facts the pipeline
   guarantees (file landed in the right bucket, every blocker was posted inline, the
   thread was resolved) rather than regexing free-form output. With LLMs in the loop
   this is mandatory: assert on what the system *did* with the output, not the
   output's wording.
4. **Deterministic paths get deterministic tests.** Where a pipeline has
   deterministic short-circuits, test those without the expensive/flaky dependency;
   reserve end-to-end-with-model tests for genuinely model-dependent judgments, and
   keep their assertions tolerant of model variance.
5. **Test configs come from production defaults** — spread the exported defaults and
   override the field under test (see [configuration.md](configuration.md) rule 3).
6. **Fixtures are data, not code** — scenario folders with declarative config; adding
   a case means adding files, not test logic.

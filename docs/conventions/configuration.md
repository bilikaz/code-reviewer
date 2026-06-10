# Configuration

**Rules.**

1. **One env read point.** `process.env` (or the platform equivalent) is read in
   exactly one loader function. Everything downstream consumes a typed config
   object. A new setting = one typed field + a default + one read in the loader —
   never a scattered `process.env.X`.
2. **Precedence is explicit:** CLI flag > environment > default, implemented once in
   the loader, not re-decided per call site.
3. **Defaults are exported** so tests build their configs from the real defaults and
   override only what the test exercises. A test that hand-retypes the default
   config silently stops matching production the day a default changes.
4. **Parse helpers, not ad-hoc coercion** — `asNumber(v, fallback)`,
   `asBool(v)` ("1"/"true"), `pick(...candidates)`. One definition of what counts
   as true.
5. **Validate per selected mode.** Only the credentials/settings the chosen mode
   needs are required; validation messages say exactly what to set and how.
6. **Safety gates are environmental, not flags.** When a mode is dangerous unless
   sandboxed, detect the sandbox by artifacts the runtime creates (e.g.
   `/.dockerenv`), never by an env variable any caller can export. Same principle
   for identity: derive "who am I" from the credential (`GET /user`), not from
   CI-shaped environment hints.

**Tolerated exception:** presentation concerns (TTY detection, `NO_COLOR`) may read
the environment directly at the presentation site — they are output formatting, not
configuration.

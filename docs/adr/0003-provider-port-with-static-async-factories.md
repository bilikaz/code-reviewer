# ADR-0003: Provider port with static async factories

Status: Accepted (2026-06-10)

## Context

The reviewer posts to GitHub, GitLab, and Bitbucket, plus a console-echo `local://`
mode and a `mock://` test double. Each platform differs in auth, comment/thread
models, and what verdict actions a bot may perform. Construction needs async work
(resolving the bot identity from the token, parsing the URL, setting up fixture
repos).

## Decision

One interface — `Provider` in `src/providers/types.ts` — five adapters. Commitments:

- **One PR per instance.** PR identity is captured at construction; methods take no
  ref parameter.
- **Private constructor + `static async create(config)`.** Async setup happens in the
  factory; instances are always fully initialized. `detectProvider(url)` is the single
  URL-shape → provider dispatch point, used by `loadConfig` and `makeVcs`.
- **Semantic outcomes over mechanics.** `approve()` / `reject()` internally apply
  platform rules (GitHub bots post a COMMENT review instead of approving; GitLab and
  Bitbucket have no native request-changes, so only the summary lands). Callers never
  branch on provider name; the process exit code is the universal gate.
- **Diff work is local.** Changed files, per-file diffs, and rename detection always
  come from `git` against the checkout (ADR-0004); the VCS API supplies metadata,
  comments, and writes. This keeps diff semantics identical across providers.
- **Bot identity comes from the token** (`GET /user`), not from environment shape —
  so reconcile recognizes its own prior comments regardless of how the run is hosted.

## Consequences

- Adding a destination = one file implementing the port + one `detectProvider` branch
  + one `makeVcs` case + a token field in config.
- Platform degradation rules are encapsulated where the platform knowledge lives.
- The mock provider records side effects (`postedInline`, `verdicts`, …), giving tests
  a structural view of what the pipeline did without network access.

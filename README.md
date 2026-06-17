# reviewer

LLM-driven pull-request reviewer. Posts inline findings, reconciles prior bot threads on follow-up pushes, and writes a summary verdict.

- **VCS**: GitHub, GitLab, Bitbucket (pluggable; `local://` for console-only branch review, `mock://` for tests)
- **LLM**: any OpenAI-compatible `/v1` endpoint (Anthropic, OpenAI, vLLM, Ollama, OpenRouter, Groq, …)
- **Runtime**: ships as a self-contained Docker image — consumers don't need Node or pnpm

## How it works

Four stages, run in order by `reviewer run`:

1. **fetch** — PR metadata, changed files, diffs, prior bot threads, project standards
2. **reconcile** — re-judge each unresolved bot thread against the new head; relocate on renames, auto-address on deletion (skipped on first run)
3. **review** — LLM analyzes the diff with read-only tools available (`Read`/`Grep`/`Ls`/`Glob`/`Tail`), posts inline findings
4. **summarize** — derives final verdict (`approve` / `reject`), posts a summary comment

Each stage is also addressable on its own (e.g. `reviewer review --pr <url>`).

## Quick start (GitHub Actions)

Copy [.github/workflows/review.yml](.github/workflows/review.yml) into your repo, then set in **Settings → Secrets and variables → Actions**:

| Kind | Name | Example |
| --- | --- | --- |
| Secret | `LLM_URL` | `https://<your_ip_or_domain>/v1` |
| Secret | `LLM_KEY` | `sk-…` |
| Variable | `LLM_MODEL` | `deepseek-ai/DeepSeek-V4-Flash` (optional — auto-detected if unset) |
| Secret | `REVIEWER_GH_TOKEN` | optional PAT — see below |

`GITHUB_TOKEN` is injected automatically and is enough to **post** comments. It can't **resolve** review threads, though: the default token is a GitHub App (integration) token, and `resolveReviewThread` isn't available to integrations ("Resource not accessible by integration"). So on follow-up pushes, reconcile decides a thread is addressed but can't clean it up. To enable thread resolution, add a user **PAT** as `REVIEWER_GH_TOKEN` (fine-grained: *Pull requests → read & write*, or classic `repo`); the workflow uses it when present and falls back to `GITHUB_TOKEN` otherwise.

The workflow builds the reviewer image from source on each run and triggers on every PR open / synchronize / reopen. (A pre-built image on GHCR is planned — until then, consumers should vendor the Dockerfile or build from a tagged release.)

## Quick start (npm dependency)

For Node projects, consume the reviewer as a `devDependency` instead of building the image — no Docker required. Works with npm, yarn, or pnpm.

Add it to the consumer project from the npm registry:

```json
"devDependencies": {
  "@bilikaz/code-reviewer": "^0.2.0"
}
```

(A git-tag form also works for unpublished revisions — `"@bilikaz/code-reviewer": "github:bilikaz/code-reviewer#<tag>"` — because `dist/` is committed: prebuilt JavaScript, no install-time build. Node refuses to run TypeScript from inside `node_modules`, so compiled output is shipped instead. A private repo consumed this way needs a PAT in the install step.)

Then copy [examples/review.yml](examples/review.yml) into `<your-project>/.github/workflows/` and set the same `LLM_URL` / `LLM_KEY` / `LLM_MODEL` secrets as above.

Run it locally the same way:

```bash
npx reviewer run --pr https://github.com/owner/repo/pull/123    # yarn: yarn reviewer ... | pnpm: pnpm exec reviewer ...
```

Requires Node ≥24 in the consumer (to run the compiled CLI).

## Local usage

```bash
cp .env.example .env   # fill in LLM_URL, LLM_KEY, GITHUB_TOKEN
docker build -t reviewer .
docker run --rm --env-file .env -v "$PWD:/workspace" -w /workspace \
  reviewer run --pr https://github.com/owner/repo/pull/123
```

### Local branch review (`local://`)

Review the **current checkout's branch against a base ref** — no PR, no VCS API, no token. Instead of posting, the reviewer **echoes each action to the console** (inline comments with `file:line`, the summary, and a green/red verdict) — like a real provider's posts, just printed. Handy for a fast pre-push pass, especially pointed at a small local model while CI uses a heavier one.

```bash
docker build -t reviewer .   # once (or after changing the reviewer)
docker run --rm -t --env-file .env -v "$PWD:/workspace" -w /workspace \
  reviewer review --pr local://main
```

(`-t` gives a TTY so the output is colored; without it, or under `NO_COLOR`, it prints plain.)

`local://<base>` diffs `<base>...HEAD` (base defaults to `main`). Use `local://<branch-or-sha>` to pick a different base.

> **Must run inside a container.** Local review gives the LLM read-only file tools (`Read`/`Grep`/`Ls`/`Glob`/`Tail`) against the mounted checkout — no shell, but they can read any file the process can reach. The container is the sandbox. The CLI refuses `local://` unless it detects a container (`/.dockerenv` / `/run/.containerenv`, created by the runtime — not a flag a caller can set), so it can't hand an LLM file access to a bare host.

### Commands

| Command | What runs |
| --- | --- |
| `run` | fetch → reconcile (if unresolved bot threads) → review → summarize |
| `fetch` | fetch only |
| `reconcile` | fetch + reconcile |
| `review` | fetch + review |
| `summarize` | fetch + summarize |

### Flags

```
--pr <url>          required (or set PR_URL env). Real PR URL, mock://<scenario>,
                    or local://<base> (review current branch vs base; Docker only)
--llm-url <url>     overrides LLM_URL
--llm-key <key>     overrides LLM_KEY
--llm-model <name>  overrides LLM_MODEL
```

## Configuration

All config is env-only and read once at startup. See [.env.example](.env.example).

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `LLM_URL` | yes | — | OpenAI-compatible base URL |
| `LLM_KEY` | no | — | omit for self-hosted endpoints with no auth (Authorization header is skipped) |
| `LLM_MODEL` | no | auto-detect from `/models` | |
| `GITHUB_TOKEN` / `GITLAB_TOKEN` / `BITBUCKET_TOKEN` | one | — | the one matching the PR URL |
| `LLM_TEMPERATURE` | no | `0.2` | |
| `LLM_MAX_OUTPUT_TOKENS` | no | `32768` | |
| `LLM_HEAL_RETRIES` | no | `2` | retries when LLM output fails schema validation |
| `LLM_DEBUG` | no | off | `1`/`true` dumps the full request body per LLM call (very chatty) |

## Development

```bash
pnpm install
pnpm typecheck
pnpm build         # tsc -> dist/ (+ copies prompt.md / schema.json assets)
pnpm start --pr <url>   # run from source (node --experimental-transform-types)
pnpm test          # builds the test image, mounts node_modules, runs vitest
```

The package ships compiled JavaScript: `tsconfig.build.json` emits `src/` to `dist/`, and [scripts/copy-assets.mjs](scripts/copy-assets.mjs) copies the runtime `.md`/`.json` assets next to the compiled modules. `bin` and `files` both point at `dist/`. **`dist/` is committed** so git-dependency consumers get prebuilt JS with no install-time build; after changing `src/`, run `pnpm build` and commit the result (CI's `dist-fresh` job fails if it's stale). The Docker image is the exception — it runs the CLI from `src/` directly via the entrypoint, so it ignores `dist/` entirely.

Tests require `tests/.env` (see [tests/.env.example](tests/.env.example)) — a real LLM endpoint is needed because the E2E suite drives the full pipeline against fixture repos via the `mock://` VCS provider.

### Layout

```
src/
  cli.ts              argv parser + pipeline orchestration
  ctx.ts              config loader + DI container
  stages/
    fetch/            PR metadata, diffs, standards
    reconcile/        re-judge prior bot threads
    review/           LLM review + inline findings
    summarize/        final verdict + summary comment
  llm/                client (callLLM + resolveModel, schema healing), transport (HTTP + SSE), tools (Read/Grep/Ls/Glob/Tail)
  providers/          Provider port + github / gitlab / bitbucket / local / mock adapters
  lib/                host-level helpers (git diffs, error normalization)
  logger/             Logger port + console / in-memory sinks
tests/
  e2e/                vitest end-to-end tests
  fixtures/           mock old/new repo pairs per scenario
docs/
  ARCHITECTURE.md     the map: structure, patterns, flows
  conventions/        portable engineering rules (naming, types placement, …)
  adr/                dated architecture decision records (scope: ADR-0000)
```

Documentation is layered: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is this repo's map, [docs/conventions/](docs/conventions/) holds the portable rule set (reusable across projects), and [docs/adr/](docs/adr/) is the decision log that adopts them. The working procedure that maintains these layers is the root [CLAUDE.md](CLAUDE.md) — agent sessions read it on start.

## License

Licensed under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)) — © 2026 VBTECH.

Use, modify, and run it freely, including commercially. The AGPL's copyleft means that if you distribute it or run a modified version as a service, you must make your modified source available under the AGPL — so improvements flow back.

**Commercial license.** To use it in a closed-source product or service without the AGPL's source-sharing obligations, a commercial license is available — contact **valdas@vbtech.eu**.

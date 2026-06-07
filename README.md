# reviewer

LLM-driven pull-request reviewer. Posts inline findings, reconciles prior bot threads on follow-up pushes, and writes a summary verdict.

- **VCS**: GitHub, GitLab, Bitbucket (pluggable; `mock://` for tests)
- **LLM**: any OpenAI-compatible `/v1` endpoint (Anthropic, OpenAI, vLLM, Ollama, OpenRouter, Groq, …)
- **Runtime**: ships as a self-contained Docker image — consumers don't need Node or pnpm

## How it works

Four stages, run in order by `reviewer run`:

1. **fetch** — PR metadata, changed files, diffs, prior bot threads, project standards
2. **reconcile** — re-judge each unresolved bot thread against the new head; relocate on renames, auto-address on deletion (skipped on first run)
3. **review** — LLM analyzes the diff with `Read` + `Bash` tools available, posts inline findings
4. **summarize** — derives final verdict (`approve` / `reject`), posts a summary comment

Each stage is also addressable on its own (e.g. `reviewer review --pr <url>`).

## Quick start (GitHub Actions)

Copy [.github/workflows/review.yml](.github/workflows/review.yml) into your repo, then set in **Settings → Secrets and variables → Actions**:

| Kind | Name | Example |
| --- | --- | --- |
| Secret | `LLM_URL` | `https://<your_ip_or_domain>/v1` |
| Secret | `LLM_KEY` | `sk-…` |
| Variable | `LLM_MODEL` | `deepseek-ai/DeepSeek-V4-Flash` (optional — auto-detected if unset) |

`GITHUB_TOKEN` is injected automatically.

The workflow builds the reviewer image from source on each run and triggers on every PR open / synchronize / reopen. (A pre-built image on GHCR is planned — until then, consumers should vendor the Dockerfile or build from a tagged release.)

## Quick start (npm dependency)

For Node projects, consume the reviewer as a `devDependency` instead of building the image — the CLI runs directly (no Docker, no build step; it executes its TypeScript at runtime). Works with npm, yarn, or pnpm.

Add it to the consumer project, pinned to a tag (the git form is the same for every package manager):

```json
"devDependencies": {
  "@reviewer/cli": "github:bilikaz/code-reviewer#v0.1.0"
}
```

Then copy [examples/review.yml](examples/review.yml) into `<your-project>/.github/workflows/` and set the same `LLM_URL` / `LLM_KEY` / `LLM_MODEL` secrets as above. If this reviewer repo is **private**, the consumer's install step needs a PAT — see the comments in that file.

Run it locally the same way:

```bash
npx reviewer run --pr https://github.com/owner/repo/pull/123    # yarn: yarn reviewer ... | pnpm: pnpm exec reviewer ...
```

Requires Node ≥24 in the consumer (the CLI uses TS transforms at runtime).

## Local usage

```bash
cp .env.example .env   # fill in LLM_URL, LLM_KEY, GITHUB_TOKEN
docker build -t reviewer .
docker run --rm --env-file .env -v "$PWD:/workspace" -w /workspace \
  reviewer run --pr https://github.com/owner/repo/pull/123
```

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
--pr <url>          required (or set PR_URL env)
--llm-url <url>     overrides LLM_URL
--llm-key <key>     overrides LLM_KEY
--llm-model <name>  overrides LLM_MODEL
```

## Configuration

All config is env-only and read once at startup. See [.env.example](.env.example).

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `LLM_URL` | yes | — | OpenAI-compatible base URL |
| `LLM_KEY` | yes | — | empty allowed for self-hosted endpoints with no auth |
| `LLM_MODEL` | no | auto-detect from `/models` | |
| `GITHUB_TOKEN` / `GITLAB_TOKEN` / `BITBUCKET_TOKEN` | one | — | the one matching the PR URL |
| `LLM_TEMPERATURE` | no | `0.2` | |
| `LLM_MAX_OUTPUT_TOKENS` | no | `32768` | |
| `LLM_HEAL_RETRIES` | no | `2` | retries when LLM output fails schema validation |

## Development

```bash
pnpm install
pnpm typecheck
pnpm test          # builds the test image, mounts node_modules, runs vitest
```

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
  llm/                OpenAI-compatible streaming client, tool loop, schema healing
  vcs/                github / gitlab / bitbucket / mock providers
  lib/                git diff parsing
  logger/             structured JSON logging
tests/
  e2e/                vitest end-to-end tests
  fixtures/           mock old/new repo pairs per scenario
```

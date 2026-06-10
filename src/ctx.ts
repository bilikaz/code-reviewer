// Ctx — dependency-injection container. Built once at CLI entry, passed to
// every stage. Holds:
//   - config: immutable settings (all env reads + CLI overrides live here)
//   - provider: instantiated review-platform adapter (already authenticated)
//   - logger: structured logger (swap sinks here)
//
// Single rule: process.env is read ONLY in loadConfig(). Everything
// downstream takes values from the typed config object. Env arrives via
// Docker's --env-file (see package.json's `test` script); no host-side
// .env loading.

import { existsSync } from "node:fs";

import { ConsoleLogger } from "./logger/console.ts";
import type { Logger } from "./logger/index.ts";
import { resolveModel } from "./llm/client.ts";
import { BitbucketProvider } from "./providers/bitbucket.ts";
import { GitHubProvider } from "./providers/github.ts";
import { GitLabProvider } from "./providers/gitlab.ts";
import { LocalProvider } from "./providers/local.ts";
import { MockProvider } from "./providers/mock.ts";
import type { ProviderKind, Provider } from "./providers/types.ts";
import { detectProvider } from "./providers/types.ts";

// ---- Config shape -------------------------------------------------------

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;                 // empty string = "auto-detect from /models"
  temperature: number;
  maxOutputTokens: number;
  healRetries: number;
  // When true, callLLM dumps the full system + user prompt and the assembled
  // messages array before every request. Useful for debugging "is the LLM
  // even seeing what I think it sees" — but very chatty. Off by default;
  // enable via LLM_DEBUG=1 in env.
  debug: boolean;
}

export interface DiffFilter {
  includeExtensions: string[];
  fullFileThresholdLines: number;
  bigFileHeaderLines: number;
  fullFileCoverageThreshold: number;
  narrowContextLines: number;
}

export interface VerdictGuard {
  approveBlockingSeverities: ("info" | "warning" | "blocker")[];
}

export interface ReviewConfig {
  diffFilter: DiffFilter;
  verdictGuard: VerdictGuard;
  standardsRoot: string;
  projectContext: { source: string; sections: string[] };
  reviewChecklistPath: string;
  preloadedFileMaxBytes: number;
  // Per-entry character cap for items inside the summary comment. Each
  // bullet (info finding's body, unaddressed thread's reason) is truncated
  // to this length with an ellipsis. Keeps the summary scannable when
  // the LLM produces long bodies.
  summaryCommentCharLimit: number;
}

export interface Config {
  pr: { url: string; provider: ProviderKind };
  llm: LlmConfig;
  github:    { token: string };
  gitlab:    { token: string; baseUrl: string };
  bitbucket: { token: string; baseUrl: string };
  review: ReviewConfig;
}

export interface Ctx {
  config: Config;
  provider: Provider;
  logger: Logger;
}

// ---- Inputs --------------------------------------------------------------

export interface CliOverrides {
  prUrl: string;
  llmUrl?: string;
  llmKey?: string;
  llmModel?: string;
  review?: Partial<ReviewConfig>;
  logger?: Logger;
}

// ---- Defaults ------------------------------------------------------------

// Exported so tests build their configs from the real defaults instead of
// re-typing them (see docs/conventions/configuration.md).
export const REVIEW_DEFAULTS: ReviewConfig = {
  diffFilter: {
    includeExtensions: [],
    fullFileThresholdLines: 800,
    bigFileHeaderLines: 30,
    fullFileCoverageThreshold: 0.8,
    narrowContextLines: 3,
  },
  verdictGuard: { approveBlockingSeverities: ["warning", "blocker"] },
  standardsRoot: "",
  projectContext: { source: "", sections: [] },
  reviewChecklistPath: "",
  preloadedFileMaxBytes: 200_000,
  summaryCommentCharLimit: 200,
};

// ---- Config loader (the ONLY place process.env is read) -----------------

function pick(...vals: (string | undefined)[]): string {
  for (const v of vals) if (v !== undefined && v !== "") return v;
  return "";
}

function asNumber(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v: string | undefined): boolean {
  return v === "1" || (v ?? "").toLowerCase() === "true";
}

function requireField(value: string, name: string, hint: string): string {
  if (!value) throw new Error(`missing ${name}. ${hint}`);
  return value;
}

// True when running inside a container. Docker writes `/.dockerenv` at the
// container root; Podman writes `/run/.containerenv`. Both are created by the
// runtime, not the caller — a far higher bar than an env flag (which is why
// `local://` review gates on this, not on a variable anyone can export).
function inContainer(): boolean {
  return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

export function loadConfig(opts: CliOverrides): Config {
  const e = process.env;
  if (!opts.prUrl) throw new Error("loadConfig: prUrl required");

  const provider = detectProvider(opts.prUrl);

  const config: Config = {
    pr: { url: opts.prUrl, provider },
    llm: {
      baseUrl: requireField(
        pick(opts.llmUrl, e.LLM_URL).replace(/\/$/, ""),
        "LLM_URL",
        "Pass --llm-url or set LLM_URL.",
      ),
      // Optional — local self-hosted LLMs typically don't auth. When empty,
      // the Authorization header is omitted from requests.
      apiKey: pick(opts.llmKey, e.LLM_KEY),
      model: pick(opts.llmModel, e.LLM_MODEL), // empty → auto-detected in buildCtx
      temperature: asNumber(e.LLM_TEMPERATURE, 0.2),
      // 32k by default — large enough for reasoning models that burn tokens
      // on internal "thinking" before emitting the JSON output. Non-thinking
      // models will simply finish well under the cap.
      maxOutputTokens: asNumber(e.LLM_MAX_OUTPUT_TOKENS, 32_768),
      healRetries: asNumber(e.LLM_HEAL_RETRIES, 2),
      debug: asBool(e.LLM_DEBUG),
    },
    github:    { token: pick(e.GITHUB_TOKEN, e.GH_TOKEN) },
    gitlab:    { token: pick(e.GITLAB_TOKEN),    baseUrl: pick(e.GITLAB_BASE_URL) },
    bitbucket: { token: pick(e.BITBUCKET_TOKEN), baseUrl: pick(e.BITBUCKET_BASE_URL) },
    review: { ...REVIEW_DEFAULTS, ...opts.review },
  };

  // Per-provider validation. Only the selected provider's credentials must be present.
  switch (provider) {
    case "github":
      requireField(config.github.token, "GITHUB_TOKEN", "Set GITHUB_TOKEN (or GH_TOKEN).");
      break;
    case "gitlab":
      requireField(config.gitlab.token, "GITLAB_TOKEN", "Set GITLAB_TOKEN.");
      break;
    case "bitbucket":
      requireField(config.bitbucket.token, "BITBUCKET_TOKEN", "Set BITBUCKET_TOKEN.");
      break;
    case "mock":
      break;
    case "local":
      // Local review gives the LLM the Bash/Read tools against the real
      // checkout. Those tools assume a throwaway sandbox; running on a bare
      // host would hand an LLM unsandboxed shell + file access to your
      // machine. Require an actual container — detect it rather than trust an
      // env flag (which any caller could set on the host).
      if (!inContainer()) {
        throw new Error(
          "local review must run inside a container (the LLM gets shell + file access, " +
          "and the container is the sandbox). Run:\n" +
          "  docker build -t reviewer .\n" +
          "  docker run --rm -v \"$PWD:/workspace\" -w /workspace --env-file .env \\\n" +
          "    reviewer review --pr local://main",
        );
      }
      break;
  }

  return config;
}

// ---- VCS construction (plain dispatch — no env reads) -------------------

function makeProvider(c: Config): Promise<Provider> {
  switch (c.pr.provider) {
    case "github":    return GitHubProvider.create(c);
    case "gitlab":    return GitLabProvider.create(c);
    case "bitbucket": return BitbucketProvider.create(c);
    case "mock":      return MockProvider.create(c);
    case "local":     return LocalProvider.create(c);
  }
}

// ---- buildCtx (thin orchestrator) ---------------------------------------

export async function buildCtx(opts: CliOverrides): Promise<Ctx> {
  const config = loadConfig(opts);
  const [provider] = await Promise.all([
    makeProvider(config),
    (async () => {
      if (!config.llm.model) {
        config.llm.model = await resolveModel({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
        });
      }
    })(),
  ]);

  return {
    config,
    provider,
    logger: opts.logger ?? new ConsoleLogger(),
  };
}

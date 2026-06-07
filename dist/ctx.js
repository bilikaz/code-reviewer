// Ctx — dependency-injection container. Built once at CLI entry, passed to
// every stage. Holds:
//   - config: immutable settings (all env reads + CLI overrides live here)
//   - vcs:    instantiated provider (already authenticated)
//   - logger: structured logger (swap sinks here)
//
// Single rule: process.env is read ONLY in loadConfig(). Everything
// downstream takes values from the typed config object. Env arrives via
// Docker's --env-file (see package.json's `test` script); no host-side
// .env loading.
import { existsSync } from "node:fs";
import { ConsoleLogger } from "./logger/console.js";
import { resolveModel } from "./llm/model.js";
import { BitbucketProvider } from "./vcs/bitbucket.js";
import { GitHubProvider } from "./vcs/github.js";
import { GitLabProvider } from "./vcs/gitlab.js";
import { LocalVcsProvider } from "./vcs/local.js";
import { MockVcsProvider } from "./vcs/mock.js";
import { detectProvider } from "./vcs/types.js";
// ---- Defaults ------------------------------------------------------------
const REVIEW_DEFAULTS = {
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
function pick(...vals) {
    for (const v of vals)
        if (v !== undefined && v !== "")
            return v;
    return "";
}
function asNumber(v, fallback) {
    if (v === undefined || v === "")
        return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
function requireField(value, name, hint) {
    if (!value)
        throw new Error(`missing ${name}. ${hint}`);
    return value;
}
// True when running inside a container. Docker writes `/.dockerenv` at the
// container root; Podman writes `/run/.containerenv`. Both are created by the
// runtime, not the caller — a far higher bar than an env flag (which is why
// `local://` review gates on this, not on a variable anyone can export).
function inContainer() {
    return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}
export function loadConfig(opts) {
    const e = process.env;
    if (!opts.prUrl)
        throw new Error("loadConfig: prUrl required");
    const provider = detectProvider(opts.prUrl);
    const config = {
        pr: { url: opts.prUrl, provider },
        llm: {
            baseUrl: requireField(pick(opts.llmUrl, e.LLM_URL).replace(/\/$/, ""), "LLM_URL", "Pass --llm-url or set LLM_URL."),
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
            debug: pick(e.LLM_DEBUG) === "1" || pick(e.LLM_DEBUG).toLowerCase() === "true",
        },
        github: { token: pick(e.GITHUB_TOKEN, e.GH_TOKEN) },
        gitlab: { token: pick(e.GITLAB_TOKEN), baseUrl: pick(e.GITLAB_BASE_URL) },
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
                throw new Error("local review must run inside a container (the LLM gets shell + file access, " +
                    "and the container is the sandbox). Run:\n" +
                    "  docker build -t reviewer .\n" +
                    "  docker run --rm -v \"$PWD:/workspace\" -w /workspace --env-file .env \\\n" +
                    "    reviewer review --pr local://main");
            }
            break;
    }
    return config;
}
// ---- VCS construction (plain dispatch — no env reads) -------------------
function makeVcs(c) {
    switch (c.pr.provider) {
        case "github": return GitHubProvider.create(c);
        case "gitlab": return GitLabProvider.create(c);
        case "bitbucket": return BitbucketProvider.create(c);
        case "mock": return MockVcsProvider.create(c);
        case "local": return LocalVcsProvider.create(c);
    }
}
// ---- buildCtx (thin orchestrator) ---------------------------------------
export async function buildCtx(opts) {
    const config = loadConfig(opts);
    const [vcs] = await Promise.all([
        makeVcs(config),
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
        vcs,
        logger: opts.logger ?? new ConsoleLogger(),
    };
}

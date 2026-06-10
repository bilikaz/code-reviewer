// One bot inline finding awaiting action: the root comment of an unresolved
// inline thread authored by the bot. The pipeline gate (cli.ts), reconcile's
// candidate selection, and summarize's no-reconcile fallback all share this
// predicate — they must agree or the verdict drifts (ADR-0011).
export function isOpenBotThread(c) {
    return c.by === "bot" && c.inline !== undefined && !c.resolved && !c.parentId;
}
// Dispatch helper: returns which provider's `create()` should handle a URL.
export function detectProvider(url) {
    if (/^mock:\/\//.test(url))
        return "mock";
    if (/^local:\/\//.test(url))
        return "local";
    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url))
        return "github";
    if (/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/-\/merge_requests\/\d+/.test(url))
        return "gitlab";
    if (/^https?:\/\/bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/\d+/.test(url))
        return "bitbucket";
    if (/^https?:\/\/[^/]+\/projects\/[^/]+\/repos\/[^/]+\/pull-requests\/\d+/.test(url))
        return "bitbucket";
    throw new Error(`unsupported PR URL: ${url}`);
}

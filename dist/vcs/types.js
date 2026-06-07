// Dispatch helper: returns which provider's `create()` should handle a URL.
export function detectProvider(url) {
    if (/^mock:\/\//.test(url))
        return "mock";
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

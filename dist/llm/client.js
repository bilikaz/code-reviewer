// Minimal LLM transport. POSTs to an OpenAI-compatible /chat/completions
// endpoint, returns the raw Response. SSE parsing lives in stream.ts.
export async function postChat(args) {
    const headers = {
        "Content-Type": "application/json",
        "Accept": args.req.stream ? "text/event-stream" : "application/json",
    };
    if (args.apiKey)
        headers["Authorization"] = `Bearer ${args.apiKey}`;
    const resp = await fetch(`${args.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(args.req),
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 1024)}`);
    }
    return resp;
}

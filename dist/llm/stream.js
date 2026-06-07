// SSE parser for OpenAI-compatible /chat/completions streams.
//
// Each chunk is `data: {json}\n\n`, terminated by `data: [DONE]`. We
// accumulate `delta.content` (the visible text) and `delta.tool_calls`
// (function calls the LLM is asking us to execute) into a final shape that
// looks like a non-streaming completion's `choices[0].message`.
//
// Side effect: while streaming, write `delta.content` to stderr live so the
// CI log shows the LLM's output as it's produced — the same UX the old
// Python harness gave us via stream-json + jq.
export async function readStream(resp, opts) {
    if (!resp.body)
        throw new Error("LLM response has no body");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    const acc = {
        content: "",
        tool_calls: [],
        finish_reason: null,
        usage: null,
    };
    // Tool calls arrive as fragments addressed by `index`. Build an array of
    // partial pieces and finalize at the end.
    const partial = [];
    function processLine(line) {
        // Returns true if [DONE] sentinel seen — caller can stop early.
        if (!line.startsWith("data:"))
            return false;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]")
            return true;
        if (!payload)
            return false;
        let chunk;
        try {
            chunk = JSON.parse(payload);
        }
        catch {
            return false; // malformed line — skip
        }
        if (chunk.usage)
            acc.usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice)
            return false;
        if (choice.finish_reason)
            acc.finish_reason = choice.finish_reason;
        const delta = choice.delta;
        if (!delta)
            return false;
        if (typeof delta.content === "string" && delta.content.length > 0) {
            acc.content += delta.content;
            opts?.onText?.(delta.content);
        }
        if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
                const slot = (partial[tc.index] ??= { id: "", name: "", arguments: "" });
                if (tc.id)
                    slot.id = tc.id;
                if (tc.function?.name)
                    slot.name += tc.function.name;
                if (tc.function?.arguments)
                    slot.arguments += tc.function.arguments;
            }
        }
        return false;
    }
    outer: while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by blank lines; we process line-by-line.
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, "");
            buffer = buffer.slice(idx + 1);
            if (processLine(line))
                break outer;
        }
    }
    // Flush any trailing partial line.
    if (buffer.length > 0)
        processLine(buffer);
    for (const p of partial) {
        if (p.id || p.name || p.arguments) {
            acc.tool_calls.push({
                id: p.id,
                type: "function",
                function: { name: p.name, arguments: p.arguments },
            });
        }
    }
    return acc;
}

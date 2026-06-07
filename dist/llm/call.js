// One LLM "call" per stage. Internally a loop: stream a chat completion →
// if it returned tool_calls, execute them locally and feed the results back,
// then re-stream. When the LLM returns final content (no tool_calls), parse
// the JSON, validate against the schema, and either return or heal.
import { Ajv } from "ajv";
import { postChat } from "./client.js";
import { readStream } from "./stream.js";
import { execTool, TOOL_SCHEMAS } from "./tools/index.js";
export class LLMValidationFailed extends Error {
}
function serializeSections(sections) {
    const parts = [];
    for (const { tag, content } of sections) {
        const body = content.trimEnd();
        if (!tag)
            parts.push(body);
        else
            parts.push(`<${tag}>\n${body}\n</${tag}>`);
    }
    return parts.join("\n\n");
}
const JSON_FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)```/g;
function extractJson(text) {
    const candidates = [];
    for (const m of text.matchAll(JSON_FENCE_RE))
        candidates.push(m[1].trim());
    candidates.push(text.trim());
    for (const c of candidates) {
        try {
            return JSON.parse(c);
        }
        catch { /* try next */ }
    }
    // Longest-span scan: shrink suffixes until JSON.parse succeeds.
    let best = null;
    for (const opener of ["{", "["]) {
        let i = text.indexOf(opener);
        while (i >= 0) {
            for (let end = text.length; end > i + 1; end--) {
                try {
                    const v = JSON.parse(text.slice(i, end));
                    const span = end - i;
                    if (!best || span > best.span)
                        best = { span, value: v };
                    break;
                }
                catch { /* shrink */ }
            }
            i = text.indexOf(opener, i + 1);
        }
    }
    if (best)
        return best.value;
    throw new Error("no JSON object or array could be parsed from response");
}
function healPrompt(error) {
    return [
        "Your previous response could not be used:",
        "",
        `  Error: ${error}`,
        "",
        "Re-emit your response exactly conforming to the schema you were given.",
        "Same content — only fix the structure. Output the JSON only, no prose, no fences.",
    ].join("\n");
}
export async function callLLM(args) {
    const { ctx } = args;
    const log = ctx.logger.child(args.stage);
    // validateSchema: false skips draft-07 meta-schema verification. We ship
    // the schemas; we don't need ajv to verify their grammar at runtime.
    const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
    const validate = ajv.compile(args.schema);
    const system = serializeSections(args.systemSections);
    const user = serializeSections(args.userSections);
    const messages = [
        { role: "system", content: system },
        { role: "user", content: user },
    ];
    const { baseUrl, apiKey, model, healRetries, temperature, maxOutputTokens } = ctx.config.llm;
    const useTools = args.tools !== false;
    let healAttempts = 0;
    let toolCalls = 0;
    let lastError = null;
    let lastText = "";
    let totalPrompt = 0, totalCompletion = 0, totalAll = 0;
    for (let attempt = 0; attempt <= healRetries; attempt++) {
        let finalText = "";
        while (true) {
            const promptBytes = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
            log.info("llm.request", { model, attempt, prompt_bytes: promptBytes, messages: messages.length });
            const req = {
                model,
                messages,
                tools: useTools ? TOOL_SCHEMAS : undefined,
                tool_choice: useTools ? "auto" : undefined,
                temperature: Number.isFinite(temperature) ? temperature : 0.2,
                max_tokens: maxOutputTokens,
                stream: true,
                stream_options: { include_usage: true },
            };
            // LLM_DEBUG=1 dumps the full JSON body (no URL, no headers, no
            // credentials). Lets the operator verify what the LLM actually sees.
            if (ctx.config.llm.debug)
                log.debug("llm.request.body", { body: req });
            const resp = await postChat({ baseUrl, apiKey, req });
            const msg = await readStream(resp, { onText: (s) => ctx.logger.stream(s) });
            if (msg.usage) {
                totalPrompt += msg.usage.prompt_tokens;
                totalCompletion += msg.usage.completion_tokens;
                totalAll += msg.usage.total_tokens;
            }
            if (msg.tool_calls.length > 0) {
                messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });
                for (const tc of msg.tool_calls) {
                    toolCalls++;
                    log.info("tool.call", { name: tc.function.name, args_preview: tc.function.arguments.slice(0, 200) });
                    const result = await execTool(tc);
                    messages.push({ role: "tool", content: result.output, tool_call_id: tc.id });
                }
                continue;
            }
            finalText = msg.content;
            lastText = finalText;
            break;
        }
        let parsed;
        try {
            parsed = extractJson(finalText);
        }
        catch (e) {
            lastError = `JSON parse: ${e.message}`;
        }
        if (parsed !== undefined) {
            if (validate(parsed)) {
                log.info("llm.done", {
                    prompt_tokens: totalPrompt,
                    completion_tokens: totalCompletion,
                    heal_attempts: healAttempts,
                    tool_calls: toolCalls,
                });
                return {
                    validated: parsed,
                    usage: { promptTokens: totalPrompt, completionTokens: totalCompletion, totalTokens: totalAll },
                    healAttempts,
                    toolCalls,
                    rawText: lastText,
                };
            }
            lastError = `schema: ${ajv.errorsText(validate.errors, { separator: "; " })}`;
        }
        if (attempt < healRetries) {
            healAttempts++;
            log.warn("llm.heal", { attempt: healAttempts, reason: lastError ?? "unknown" });
            messages.push({ role: "assistant", content: finalText });
            messages.push({ role: "user", content: healPrompt(lastError ?? "unknown") });
        }
    }
    log.error("llm.exhausted", { heal_retries: healRetries, last_error: lastError });
    throw new LLMValidationFailed(`stage=${args.stage} exhausted ${healRetries} heal attempts; last: ${lastError}`);
}

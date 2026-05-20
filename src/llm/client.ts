// Minimal LLM transport. POSTs to an OpenAI-compatible /chat/completions
// endpoint, returns the raw Response. SSE parsing lives in stream.ts.

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSchema[];
  tool_choice?: "auto" | "required" | "none";
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export async function postChat(args: {
  baseUrl: string;
  apiKey: string;
  req: ChatRequest;
}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": args.req.stream ? "text/event-stream" : "application/json",
  };
  if (args.apiKey) headers["Authorization"] = `Bearer ${args.apiKey}`;
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

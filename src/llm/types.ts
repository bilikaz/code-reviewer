// Shared LLM contract — the vocabulary used across llm/ and by stages.
//
// Wire shapes mirror the OpenAI /chat/completions JSON (snake_case fields
// are not renamed); Section and LLMResult are the client API's input/output
// shapes. Behavior lives in client.ts (consumer API) and transport.ts (wire).

// ---- Wire shapes (OpenAI-compatible) --------------------------------------

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

// ---- Client API shapes -----------------------------------------------------

// One tagged prompt section; serialized as <tag>content</tag>, empty tag =
// untagged prose (ADR-0006).
export type Section = { tag: string; content: string };

export interface LLMResult<T> {
  validated: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  healAttempts: number;
  toolCalls: number;
  rawText: string;
}

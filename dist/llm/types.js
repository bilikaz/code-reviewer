// Shared LLM contract — the vocabulary used across llm/ and by stages.
//
// Wire shapes mirror the OpenAI /chat/completions JSON (snake_case fields
// are not renamed); Section and LLMResult are the client API's input/output
// shapes. Behavior lives in client.ts (consumer API) and transport.ts (wire).
export {};

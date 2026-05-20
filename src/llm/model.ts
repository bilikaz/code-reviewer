// Resolves which model to use. Explicit override wins; otherwise we ask the
// LLM endpoint via `GET /models` and pick the first id. No hardcoded provider
// heuristics — if neither path yields a model, error out.

export interface ResolveModelArgs {
  baseUrl: string;
  apiKey: string;
  override?: string;
}

export async function resolveModel(args: ResolveModelArgs): Promise<string> {
  if (args.override) return args.override;

  const url = `${args.baseUrl.replace(/\/$/, "")}/models`;
  const headers: Record<string, string> = {};
  if (args.apiKey) headers["Authorization"] = `Bearer ${args.apiKey}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `model auto-detection failed: GET ${url} → HTTP ${resp.status}. ` +
      `Pass --llm-model explicitly or set LLM_MODEL. ${text.slice(0, 200)}`,
    );
  }
  const data = (await resp.json()) as { data?: Array<{ id: string }> };
  const first = data.data?.[0]?.id;
  if (!first) {
    throw new Error(
      `model auto-detection failed: ${url} returned no models. ` +
      `Pass --llm-model explicitly or set LLM_MODEL.`,
    );
  }
  return first;
}

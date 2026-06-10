# Error handling

**Rules.**

1. **Normalize unknown throws.** `catch (e)` binds `unknown`; `(e as Error).message`
   is a cast, not a check — it yields `undefined` when a non-Error was thrown, and
   the log line silently loses its cause. Every catch site goes through one helper:

   ```ts
   export function errorMessage(e: unknown): string {
     if (e instanceof Error) return e.message;
     if (typeof e === "string") return e;
     try { return JSON.stringify(e); } catch { return String(e); }
   }
   ```

   The `(e as Error)` cast is banned; grep for it should return nothing.

2. **Context-prefixed messages.** Throw `Error` with `context: detail`
   ("`GitLab API 403: …`", "`missing LLM_URL. Pass --llm-url or set LLM_URL.`").
   The message must let the operator act without a stack trace.

3. **Per-item catch in batches.** When processing N independent items (posting N
   comments, resolving N threads), one failure is caught, logged with its item's
   identity, counted — and the loop continues. One bad item must not abort the run.

4. **Fail fast at startup.** Validate configuration/credentials at load time with
   actionable hints, before any network or work happens.

5. **Exit codes are the contract** for CLI tools running as gates: success / policy
   failure / usage error get distinct codes; logs explain, codes decide.

6. **Error classes are named `<X>Error`** and reserved for failures a caller might
   meaningfully catch by type; everything else throws plain `Error` with a good
   message.

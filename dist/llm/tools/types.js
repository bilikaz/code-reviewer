// Shared types + helpers for LLM tools.
export const OUTPUT_CAP = 64 * 1024; // 64 KB per tool result is plenty; truncate beyond.
export function cap(s) {
    if (s.length <= OUTPUT_CAP)
        return s;
    return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}

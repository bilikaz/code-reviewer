// Settings module — post-refactor. Boolean keys default to `false` when the
// env var is missing, so callers can use the return value directly as a flag.

export function getSetting(key: string, defaultValue: string | boolean = ""): string | boolean {
  const raw = process.env[key.toUpperCase()];
  if (raw === undefined) return defaultValue;
  if (typeof defaultValue === "boolean") return raw === "1" || raw.toLowerCase() === "true";
  return raw;
}

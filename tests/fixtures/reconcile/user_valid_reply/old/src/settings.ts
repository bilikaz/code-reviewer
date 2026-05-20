// Settings module — pre-refactor returns possibly-undefined.

export function getSetting(key: string): string | undefined {
  return process.env[key.toUpperCase()];
}

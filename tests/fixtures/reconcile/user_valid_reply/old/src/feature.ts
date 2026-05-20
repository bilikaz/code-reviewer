import { getSetting } from "./settings.ts";

export function shouldEnableDebug(): boolean {
  // Pre-refactor: getSetting returned undefined for missing keys, so this
  // expression evaluated to undefined and effectively meant "off". Still
  // unclear at the callsite.
  return getSetting("debug") === "1";
}

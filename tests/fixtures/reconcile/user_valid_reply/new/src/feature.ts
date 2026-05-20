import { getSetting } from "./settings.ts";

export function shouldEnableDebug(): boolean {
  // Post-refactor: passing a boolean default makes getSetting's return type
  // boolean, so the result is safe as a flag.
  return getSetting("debug", false) as boolean;
}

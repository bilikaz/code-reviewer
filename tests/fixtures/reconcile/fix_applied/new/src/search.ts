import { db } from "./db.ts";

const MAX_LIMIT = 100;

export async function search(q: string, limit: number): Promise<unknown> {
  // Address: clamp `limit` to a sane range before passing through.
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
  return db.query("SELECT * FROM items WHERE name LIKE ? LIMIT ?", [`%${q}%`, safeLimit]);
}

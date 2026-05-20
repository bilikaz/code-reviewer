import { db } from "./db.ts";

export async function search(q: string, limit: number): Promise<unknown> {
  return db.query("SELECT * FROM items WHERE name LIKE ? LIMIT ?", [`%${q}%`, limit]);
}

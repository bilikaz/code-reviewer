import { db } from "./db.ts";

export async function lookupUser(id: string): Promise<unknown> {
  // SQL injection: `id` from the URL is concatenated straight into the query.
  // The dev reply claimed the frontend sanitizes — irrelevant for a backend
  // endpoint that can be called by anyone with the URL.
  const sql = "SELECT * FROM users WHERE id = '" + id + "'";
  const row = await db.queryOne(sql);
  return row;
}

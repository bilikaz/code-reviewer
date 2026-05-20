// Authentication helpers — pre-rename version of this module.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET = process.env.AUTH_SECRET ?? "dev-only-do-not-ship";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // one week

export interface AuthToken {
  userId: string;
  issuedAt: number;
  signature: string;
}

export function makeToken(userId: string): AuthToken {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac("sha256", SECRET).update(payload).digest("hex");
  return { userId, issuedAt, signature };
}

export function verifyToken(token: AuthToken): boolean {
  const age = Math.floor(Date.now() / 1000) - token.issuedAt;
  if (age < 0 || age > TOKEN_TTL_SECONDS) return false;
  const payload = `${token.userId}.${token.issuedAt}`;
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  const a = Buffer.from(token.signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function generateSessionId(): string {
  return randomBytes(16).toString("hex");
}

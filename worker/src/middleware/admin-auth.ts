/**
 * Admin authentication middleware — constant-time Bearer token check
 * with optional token expiry via ADMIN_TOKEN_EXPIRES_AT env var
 */
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const requireAdmin = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const token = authHeader.slice(7);
    const expected = c.env.ADMIN_API_KEY;

    if (!expected || !timingSafeEqual(token, expected)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Check optional token expiry
    const expiresAt = c.env.ADMIN_TOKEN_EXPIRES_AT;
    if (expiresAt) {
      const expiryDate = new Date(expiresAt);
      if (isNaN(expiryDate.getTime()) || new Date() > expiryDate) {
        return c.json({ error: "Token expired" }, 401);
      }
    }

    return next();
  },
);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}

/**
 * KV-based rate limiter middleware
 */
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

interface RateLimitOptions {
  maxRequests: number;
  windowSeconds: number;
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For") ?? "unknown";
    const path = new URL(c.req.url).pathname;
    const key = `ratelimit:${path}:${ip}`;

    const raw = await c.env.STATUS_KV.get(key);
    const count = raw ? parseInt(raw, 10) : 0;

    if (count >= options.maxRequests) {
      return c.json({ error: "Too many requests" }, 429);
    }

    await c.env.STATUS_KV.put(key, String(count + 1), {
      expirationTtl: options.windowSeconds,
    });

    return next();
  });
}

/**
 * GET /api/ping — simple health check endpoint
 */
import { Hono } from "hono";
import type { Env } from "../types";

export const pingRoutes = new Hono<{ Bindings: Env }>();

pingRoutes.get("/ping", (c) => {
  return c.json({ ok: true, timestamp: new Date().toISOString() });
});

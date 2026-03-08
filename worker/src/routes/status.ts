/**
 * GET /api/status — current status of all services
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import {
  SERVICE_NAMES,
  KV_KEYS,
  type LatestStatus,
  type OverallStatus,
} from "../types";
import { requireAdmin } from "../middleware/admin-auth";

const statusMessageSchema = z.object({
  text: z.string().min(1).max(500),
});

export const statusRoutes = new Hono<{ Bindings: Env }>();

statusRoutes.get("/status", async (c) => {
  // Read custom status message (set via admin dashboard)
  const statusMessage = await c.env.STATUS_KV.get("status:message");
  let parsedMessage: { text: string; updatedAt: string } | null = null;
  if (statusMessage) {
    try {
      parsedMessage = JSON.parse(statusMessage) as { text: string; updatedAt: string };
    } catch {
      parsedMessage = null;
    }
  }

  // Read overall status from KV
  const overallRaw = await c.env.STATUS_KV.get(KV_KEYS.overall);
  if (overallRaw) {
    try {
      const overall: OverallStatus = JSON.parse(overallRaw);
      return c.json({ ...overall, message: parsedMessage });
    } catch {
      // Fall through to individual service check
    }
  }

  // Fallback: read individual service statuses
  const services: Record<string, LatestStatus | null> = {};
  const results = await Promise.all(
    SERVICE_NAMES.map(async (name) => {
      const raw = await c.env.STATUS_KV.get(KV_KEYS.latest(name));
      if (!raw) return { name, data: null };
      try {
        return { name, data: JSON.parse(raw) as LatestStatus };
      } catch {
        return { name, data: null };
      }
    }),
  );

  for (const { name, data } of results) {
    services[name] = data;
  }

  return c.json({
    status: "unknown",
    services,
    updatedAt: new Date().toISOString(),
    message: parsedMessage,
  });
});

/** PUT /api/status/message — set a custom status message (admin only) */
statusRoutes.put("/status/message", requireAdmin, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = statusMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid parameters" }, 400);
  }

  await c.env.STATUS_KV.put(
    "status:message",
    JSON.stringify({ text: parsed.data.text.trim(), updatedAt: new Date().toISOString() }),
  );

  return c.json({ success: true });
});

/** DELETE /api/status/message — clear the custom status message (admin only) */
statusRoutes.delete("/status/message", requireAdmin, async (c) => {
  await c.env.STATUS_KV.delete("status:message");
  return c.json({ success: true });
});

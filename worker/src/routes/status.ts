/**
 * GET /api/status — current status of all services (tenant-scoped)
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Tenant } from "../types";
import {
  KV_KEYS,
  type LatestStatus,
  type OverallStatus,
} from "../types";
import { requireApiKey } from "../middleware/api-key-auth";

const statusMessageSchema = z.object({
  text: z.string().min(1).max(500),
});

export const statusRoutes = new Hono<{
  Bindings: Env;
  Variables: { tenant: Tenant };
}>();

statusRoutes.get("/status", async (c) => {
  const tenant = c.get("tenant");

  // Read custom status message (set via admin dashboard)
  const statusMessage = await c.env.STATUS_KV.get(KV_KEYS.tenantMessage(tenant.id));
  let parsedMessage: { text: string; updatedAt: string } | null = null;
  if (statusMessage) {
    try {
      parsedMessage = JSON.parse(statusMessage) as { text: string; updatedAt: string };
    } catch {
      parsedMessage = null;
    }
  }

  // Read overall status from KV (tenant-scoped)
  const overallRaw = await c.env.STATUS_KV.get(KV_KEYS.tenantOverall(tenant.id));
  if (overallRaw) {
    try {
      const overall: OverallStatus = JSON.parse(overallRaw);
      return c.json({ ...overall, message: parsedMessage });
    } catch {
      // Fall through to empty response
    }
  }

  // No tenant-scoped data yet — return unknown status
  return c.json({
    status: "unknown",
    services: {},
    updatedAt: new Date().toISOString(),
    message: parsedMessage,
  });
});

/** PUT /api/status/message — set a custom status message (API key auth) */
statusRoutes.put("/status/message", requireApiKey, async (c) => {
  const tenant = c.get("tenant");
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
    KV_KEYS.tenantMessage(tenant.id),
    JSON.stringify({ text: parsed.data.text.trim(), updatedAt: new Date().toISOString() }),
  );

  return c.json({ success: true });
});

/** DELETE /api/status/message — clear the custom status message (API key auth) */
statusRoutes.delete("/status/message", requireApiKey, async (c) => {
  const tenant = c.get("tenant");
  await c.env.STATUS_KV.delete(KV_KEYS.tenantMessage(tenant.id));
  return c.json({ success: true });
});

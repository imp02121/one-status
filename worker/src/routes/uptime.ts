/**
 * GET /api/uptime — daily uptime percentages for a service (tenant-scoped)
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Tenant } from "../types";
import { KV_KEYS, type DailyUptime } from "../types";

const querySchema = z.object({
  service: z.string().min(1).max(50),
  days: z.coerce.number().int().min(1).max(90).default(90),
});

export const uptimeRoutes = new Hono<{
  Bindings: Env;
  Variables: { tenant: Tenant };
}>();

uptimeRoutes.get("/uptime", async (c) => {
  const tenant = c.get("tenant");
  const parsed = querySchema.safeParse({
    service: c.req.query("service"),
    days: c.req.query("days"),
  });

  if (!parsed.success) {
    return c.json({ error: "Invalid parameters" }, 400);
  }

  const { service, days } = parsed.data;
  const entries: Array<{ date: string; uptime: DailyUptime | null }> = [];
  const now = new Date();

  const kvReads = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    return {
      dateStr,
      promise: c.env.STATUS_KV.get(KV_KEYS.tenantDailyUptime(tenant.id, service, dateStr)),
    };
  });

  const results = await Promise.all(kvReads.map((r) => r.promise));

  for (let i = 0; i < kvReads.length; i++) {
    const raw = results[i];
    entries.push({
      date: kvReads[i].dateStr,
      uptime: raw ? parseJsonSafe<DailyUptime>(raw) : null,
    });
  }

  return c.json({ service, days, entries });
});

function parseJsonSafe<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * GET /api/uptime — daily uptime percentages for a service
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { SERVICE_NAMES, KV_KEYS, type DailyUptime } from "../types";
import type { ServiceName } from "../types";

const querySchema = z.object({
  service: z.enum(SERVICE_NAMES as unknown as [string, ...string[]]),
  days: z.coerce.number().int().min(1).max(90).default(90),
});

export const uptimeRoutes = new Hono<{ Bindings: Env }>();

uptimeRoutes.get("/uptime", async (c) => {
  const parsed = querySchema.safeParse({
    service: c.req.query("service"),
    days: c.req.query("days"),
  });

  if (!parsed.success) {
    return c.json({ error: "Invalid parameters" }, 400);
  }

  const { service, days } = parsed.data;
  const serviceName = service as ServiceName;
  const entries: Array<{ date: string; uptime: DailyUptime | null }> = [];
  const now = new Date();

  const kvReads = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    return { dateStr, promise: c.env.STATUS_KV.get(KV_KEYS.dailyUptime(serviceName, dateStr)) };
  });

  const results = await Promise.all(kvReads.map((r) => r.promise));

  for (let i = 0; i < kvReads.length; i++) {
    const raw = results[i];
    entries.push({
      date: kvReads[i].dateStr,
      uptime: raw ? parseJsonSafe<DailyUptime>(raw) : null,
    });
  }

  return c.json({ service: serviceName, days, entries });
});

function parseJsonSafe<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Admin config endpoints (KV-backed, tenant-scoped, API key auth)
 *
 *   GET /admin/config — get current config
 *   PUT /admin/config — update config
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Tenant } from "../types";
import { KV_KEYS } from "../types";
import { requireApiKey } from "../middleware/api-key-auth";

const SEVERITY_VALUES = ["critical", "major", "minor", "maintenance"] as const;

const escalationRuleSchema = z.object({
  afterMinutes: z.number().int().min(1).max(1440),
  webhookUrl: z.string().url().max(500),
  mention: z.string().max(100).optional(),
});

const configSchema = z.object({
  services: z
    .array(
      z.object({
        slug: z.string().min(1).max(50),
        name: z.string().min(1).max(100),
        url: z.string().url().max(500),
        checkType: z.enum(["head", "deep-health"]),
      }),
    )
    .max(50),
  emailFrom: z.string().email().max(320),
  emailFromName: z.string().min(1).max(100),
  notifications: z.object({
    slack: z.object({
      enabled: z.boolean(),
      webhookUrl: z.string().max(500),
      channel: z.string().max(100).optional(),
      severityFilter: z.array(z.enum(SEVERITY_VALUES)).max(4),
      escalation: z.array(escalationRuleSchema).max(10),
    }),
    email: z.object({
      enabled: z.boolean(),
      onStatusChange: z.boolean(),
      onIncident: z.boolean(),
    }),
  }),
});

export const adminConfigRoutes = new Hono<{
  Bindings: Env;
  Variables: { tenant: Tenant };
}>();

/** GET /admin/config — get current config (tenant-scoped) */
adminConfigRoutes.get("/admin/config", requireApiKey, async (c) => {
  const tenant = c.get("tenant");
  const raw = await c.env.STATUS_KV.get(KV_KEYS.tenantConfig(tenant.id));
  if (!raw) {
    return c.json({ config: null });
  }

  try {
    const config = JSON.parse(raw) as unknown;
    return c.json({ config });
  } catch {
    return c.json({ config: null });
  }
});

/** PUT /admin/config — update config (tenant-scoped) */
adminConfigRoutes.put("/admin/config", requireApiKey, async (c) => {
  const tenant = c.get("tenant");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid configuration", details: parsed.error.flatten().fieldErrors }, 400);
  }

  await c.env.STATUS_KV.put(KV_KEYS.tenantConfig(tenant.id), JSON.stringify(parsed.data));

  return c.json({ message: "Configuration updated" });
});

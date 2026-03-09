import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { Env, Tenant } from "../types";
import { KV_KEYS } from "../types";
import { resolveTenant } from "./tenant-resolution";
import { createMockEnv, createMockD1 } from "../test-helpers";

const MOCK_TENANT_ROW = {
  id: "tenant-abc-123",
  name: "Acme Corp",
  slug: "acme",
  plan: "pro",
  owner_id: "user-1",
  custom_domain: null,
  custom_domain_status: "none",
  branding_logo_url: null,
  branding_color: "#3B82F6",
  branding_show_badge: 1,
  created_at: "2026-03-08T12:00:00.000Z",
};

const MOCK_CUSTOM_DOMAIN_ROW = {
  ...MOCK_TENANT_ROW,
  id: "tenant-xyz-456",
  slug: "customco",
  custom_domain: "status.customco.com",
  custom_domain_status: "active",
};

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env; Variables: { tenant: Tenant } }>();
  app.use("/*", resolveTenant);
  app.get("/api/status", (c) => {
    const tenant = c.get("tenant");
    return c.json({ tenantId: tenant.id, slug: tenant.slug });
  });
  app.get("/api/ping", (c) => c.json({ pong: true }));
  return app;
}

describe("resolveTenant middleware", () => {
  let env: Env;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const slugQuery = expect.stringContaining("WHERE slug = ?");
    const domainQuery = expect.stringContaining("WHERE custom_domain = ?");

    const d1 = createMockD1({
      firstResults: new Map<string, Record<string, unknown> | null>([
        [slugQuery as unknown as string, null],
        [domainQuery as unknown as string, null],
      ]),
    });

    // Override prepare to match on query content
    const originalPrepare = d1.prepare;
    d1.prepare = vi.fn((query: string) => {
      const stmt = (originalPrepare as (q: string) => ReturnType<D1Database["prepare"]>)(query);
      const originalBind = stmt.bind;
      stmt.bind = (...values: unknown[]) => {
        const bound = (originalBind as (...v: unknown[]) => typeof stmt)(...values);
        if (query.includes("WHERE slug = ?") && values[0] === "acme") {
          bound.first = async () => MOCK_TENANT_ROW as unknown as Record<string, unknown>;
        } else if (query.includes("WHERE custom_domain = ?") && values[0] === "status.customco.com") {
          bound.first = async () => MOCK_CUSTOM_DOMAIN_ROW as unknown as Record<string, unknown>;
        } else if (query.includes("WHERE slug = ?") || query.includes("WHERE custom_domain = ?")) {
          bound.first = async () => null;
        }
        return bound;
      };
      return stmt;
    });

    env = createMockEnv({ STATUS_DB: d1 });
    app = createApp(env);
  });

  it("resolves tenant from subdomain", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "acme.onestatus.dev" },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string; slug: string };
    expect(body.tenantId).toBe("tenant-abc-123");
    expect(body.slug).toBe("acme");
  });

  it("resolves tenant from custom domain", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "status.customco.com" },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string; slug: string };
    expect(body.tenantId).toBe("tenant-xyz-456");
    expect(body.slug).toBe("customco");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "unknown.onestatus.dev" },
    }, env);

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Status page not found");
  });

  it("returns 404 for unknown custom domain", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "status.unknown.com" },
    }, env);

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Status page not found");
  });

  it("caches tenant in KV after slug lookup", async () => {
    await app.request("/api/status", {
      headers: { Host: "acme.onestatus.dev" },
    }, env);

    const cacheKey = KV_KEYS.tenantLookupBySlug("acme");
    const cached = await env.STATUS_KV.get(cacheKey);
    expect(cached).not.toBeNull();

    const parsed = JSON.parse(cached as string) as Tenant;
    expect(parsed.id).toBe("tenant-abc-123");
    expect(parsed.slug).toBe("acme");
  });

  it("caches tenant in KV after custom domain lookup", async () => {
    await app.request("/api/status", {
      headers: { Host: "status.customco.com" },
    }, env);

    const cacheKey = KV_KEYS.tenantLookupByDomain("status.customco.com");
    const cached = await env.STATUS_KV.get(cacheKey);
    expect(cached).not.toBeNull();

    const parsed = JSON.parse(cached as string) as Tenant;
    expect(parsed.id).toBe("tenant-xyz-456");
  });

  it("uses cached tenant from KV on second request", async () => {
    // First request — populates cache
    await app.request("/api/status", {
      headers: { Host: "acme.onestatus.dev" },
    }, env);

    // Second request — should use cache (D1 won't be called again)
    const prepareSpy = env.STATUS_DB.prepare as ReturnType<typeof vi.fn>;
    prepareSpy.mockClear();

    const res = await app.request("/api/status", {
      headers: { Host: "acme.onestatus.dev" },
    }, env);

    expect(res.status).toBe(200);
    // D1 prepare should not have been called (served from cache)
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it("skips /api/ping path", async () => {
    const res = await app.request("/api/ping", {
      headers: { Host: "unknown.onestatus.dev" },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { pong: boolean };
    expect(body.pong).toBe(true);
  });

  it("uses X-Tenant-Slug header in development mode", async () => {
    env = { ...env, ENVIRONMENT: "development" };
    app = createApp(env);

    const res = await app.request("/api/status", {
      headers: {
        Host: "localhost:5173",
        "X-Tenant-Slug": "acme",
      },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string; slug: string };
    expect(body.tenantId).toBe("tenant-abc-123");
    expect(body.slug).toBe("acme");
  });

  it("ignores X-Tenant-Slug header in non-development mode", async () => {
    // Default env is "test", not "development"
    const res = await app.request("/api/status", {
      headers: {
        Host: "unknown.onestatus.dev",
        "X-Tenant-Slug": "acme",
      },
    }, env);

    // Should try subdomain resolution for "unknown", which fails
    expect(res.status).toBe(404);
  });

  it("strips port from Host header", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "acme.onestatus.dev:8787" },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { tenantId: string };
    expect(body.tenantId).toBe("tenant-abc-123");
  });

  it("returns 404 for bare base domain", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "onestatus.dev" },
    }, env);

    // onestatus.dev doesn't end with .onestatus.dev, so falls through to custom domain lookup
    // which won't find it either
    expect(res.status).toBe(404);
  });

  it("maps snake_case D1 columns to camelCase Tenant fields", async () => {
    const res = await app.request("/api/status", {
      headers: { Host: "acme.onestatus.dev" },
    }, env);

    expect(res.status).toBe(200);

    const cacheKey = KV_KEYS.tenantLookupBySlug("acme");
    const cached = JSON.parse((await env.STATUS_KV.get(cacheKey)) as string) as Tenant;
    expect(cached.ownerId).toBe("user-1");
    expect(cached.customDomain).toBeNull();
    expect(cached.customDomainStatus).toBe("none");
    expect(cached.brandingColor).toBe("#3B82F6");
    expect(cached.brandingShowBadge).toBe(true);
    expect(cached.createdAt).toBe("2026-03-08T12:00:00.000Z");
  });
});

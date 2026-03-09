import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env, Tenant } from "../types";
import { KV_KEYS } from "../types";
import { adminConfigRoutes } from "./admin-config";
import { createMockEnv, mockTenant } from "../test-helpers";

const TEST_TENANT = mockTenant();
const TEST_API_KEY = "test-api-key";
let TEST_API_KEY_HASH: string;

async function computeHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env; Variables: { tenant: Tenant } }>();
  // Inject tenant context for tests
  app.use("/api/*", async (c, next) => {
    c.set("tenant", TEST_TENANT);
    return next();
  });
  // Match production content-type middleware
  app.use("/api/*", async (c, next) => {
    const method = c.req.method;
    if (method === "POST" || method === "PUT") {
      const contentType = c.req.header("Content-Type");
      if (!contentType || !contentType.includes("application/json")) {
        return c.json({ error: "Content-Type must be application/json" }, 415);
      }
    }
    return next();
  });
  app.route("/api", adminConfigRoutes);
  return { app, env };
}

const AUTH_HEADER = { Authorization: `Bearer ${TEST_API_KEY}` };

function mockD1ForApiKey(env: Env) {
  vi.mocked(env.STATUS_DB.prepare).mockImplementation((query: string) => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(async () => {
        if (query.includes("api_keys")) {
          return {
            id: "key-1",
            tenant_id: TEST_TENANT.id,
            name: "Test Key",
            key_hash: TEST_API_KEY_HASH,
            key_prefix: "test",
            scopes: '["config:write"]',
            last_used_at: null,
            expires_at: null,
            created_at: "2026-01-01T00:00:00Z",
          };
        }
        return null;
      }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      raw: vi.fn().mockResolvedValue([]),
    };
    return stmt as unknown as D1PreparedStatement;
  });
}

function validConfig() {
  return {
    services: [
      { slug: "api", name: "API", url: "https://api.bundlenudge.com", checkType: "head" },
    ],
    emailFrom: "status@bundlenudge.com",
    emailFromName: "BundleNudge Status",
    notifications: {
      slack: {
        enabled: true,
        webhookUrl: "https://hooks.slack.com/services/T/B/X",
        channel: "#ops",
        severityFilter: ["critical", "major"],
        escalation: [],
      },
      email: {
        enabled: true,
        onStatusChange: true,
        onIncident: true,
      },
    },
  };
}

describe("GET /api/admin/config", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(async () => {
    TEST_API_KEY_HASH = await computeHash(TEST_API_KEY);
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
    mockD1ForApiKey(env);
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.request("/api/admin/config", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.request("/api/admin/config", {
      headers: { Authorization: "Bearer wrong" },
    }, env);
    expect(res.status).toBe(401);
  });

  it("returns config from KV when present", async () => {
    const config = validConfig();
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(JSON.stringify(config));

    const res = await app.request("/api/admin/config", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual(config);
  });

  it("returns config: null when no config in KV", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(null);

    const res = await app.request("/api/admin/config", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toBeNull();
  });

  it("returns config: null when KV contains invalid JSON", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce("not-valid-json{{{");

    const res = await app.request("/api/admin/config", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toBeNull();
  });

  it("reads from KV with the tenant-scoped key", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValueOnce(null);

    await app.request("/api/admin/config", {
      headers: AUTH_HEADER,
    }, env);

    expect(env.STATUS_KV.get).toHaveBeenCalledWith(KV_KEYS.tenantConfig(TEST_TENANT.id));
  });
});

describe("PUT /api/admin/config", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(async () => {
    TEST_API_KEY_HASH = await computeHash(TEST_API_KEY);
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
    mockD1ForApiKey(env);
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validConfig()),
    }, env);
    expect(res.status).toBe(401);
  });

  it("saves valid config to KV with tenant-scoped key", async () => {
    const config = validConfig();

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Configuration updated");
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantConfig(TEST_TENANT.id),
      expect.any(String),
    );
  });

  it("rejects config with missing required fields", async () => {
    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ services: [] }),
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid configuration");
    expect(body.details).toBeDefined();
  });

  it("rejects config with invalid emailFrom", async () => {
    const config = validConfig();
    config.emailFrom = "not-an-email";

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("rejects config with invalid service URL", async () => {
    const config = validConfig();
    config.services[0].url = "not-a-url";

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("rejects config with invalid checkType", async () => {
    const config = validConfig();
    (config.services[0] as Record<string, unknown>).checkType = "invalid";

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("rejects config with invalid severity filter values", async () => {
    const config = validConfig();
    (config.notifications.slack.severityFilter as string[]) = ["invalid-severity"];

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("validates escalation rules structure", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [
      { afterMinutes: 0, webhookUrl: "https://hooks.slack.com/test" } as { afterMinutes: number; webhookUrl: string },
    ];

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("accepts valid escalation rules", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [
      { afterMinutes: 30, webhookUrl: "https://hooks.slack.com/escalate" },
    ];

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(200);
  });

  it("rejects escalation rule with afterMinutes > 1440", async () => {
    const config = validConfig();
    config.notifications.slack.escalation = [
      { afterMinutes: 1441, webhookUrl: "https://hooks.slack.com/escalate" },
    ];

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("rejects more than 50 services", async () => {
    const config = validConfig();
    config.services = Array.from({ length: 51 }, (_, i) => ({
      slug: `svc-${String(i)}`,
      name: `Service ${String(i)}`,
      url: `https://svc-${String(i)}.example.com`,
      checkType: "head" as const,
    }));

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: "not json{{{",
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("validates nested notification config structure", async () => {
    const config = validConfig();
    (config.notifications as Record<string, unknown>).email = { enabled: "not-boolean" };

    const res = await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }, env);

    expect(res.status).toBe(400);
  });

  it("stores the Zod-validated (cleaned) data in KV", async () => {
    const config = validConfig();

    await app.request("/api/admin/config", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, extraField: "ignored" }),
    }, env);

    const putCalls = vi.mocked(env.STATUS_KV.put).mock.calls;
    expect(putCalls.length).toBe(1);
    const stored = JSON.parse(putCalls[0][1] as string);
    expect(stored.extraField).toBeUndefined();
    expect(stored.services).toBeDefined();
  });
});

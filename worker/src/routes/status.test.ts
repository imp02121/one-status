import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env, Tenant } from "../types";
import { KV_KEYS } from "../types";
import { statusRoutes } from "./status";
import { createMockEnv, mockOverallStatus, mockTenant } from "../test-helpers";

const TEST_TENANT = mockTenant();

// SHA-256 hash of "test-api-key" — pre-computed for test mocking
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
  app.route("/api", statusRoutes);
  return { app, env };
}

/**
 * Mock D1 that handles api_keys lookups for requireApiKey middleware.
 */
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
            scopes: '["status:write"]',
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

const AUTH_HEADER = { Authorization: `Bearer ${TEST_API_KEY}` };

describe("GET /api/status", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 200 with overall status from KV", async () => {
    const overall = mockOverallStatus();
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(null) // tenant message
      .mockResolvedValueOnce(JSON.stringify(overall));

    const res = await app.request("/api/status", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("operational");
    expect(body.services).toBeDefined();
    expect(body.updatedAt).toBeDefined();
  });

  it("returns all 7 service statuses when overall is present", async () => {
    const overall = mockOverallStatus();
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(null) // tenant message
      .mockResolvedValueOnce(JSON.stringify(overall));

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(Object.keys(body.services)).toHaveLength(7);
    expect(body.services["api"]).toBe("operational");
    expect(body.services["dashboard"]).toBe("operational");
    expect(body.services["authentication"]).toBe("operational");
    expect(body.services["edge-delivery"]).toBe("operational");
    expect(body.services["ota-updates"]).toBe("operational");
    expect(body.services["build-service"]).toBe("operational");
    expect(body.services["documentation"]).toBe("operational");
  });

  it("returns unknown status when tenant overall KV is empty", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("unknown");
    expect(body.services).toEqual({});
  });

  it("returns null for services when no KV data", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("unknown");
  });

  it("includes updatedAt timestamp in fallback response", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(body.updatedAt).toBeDefined();
    expect(new Date(body.updatedAt).getTime()).not.toBeNaN();
  });

  it("returns JSON content type", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/status", {}, env);

    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns mixed service statuses correctly", async () => {
    const overall = mockOverallStatus({
      status: "degraded",
      services: {
        "api": "operational",
        "dashboard": "degraded",
        "authentication": "operational",
        "edge-delivery": "down",
        "ota-updates": "operational",
        "build-service": "operational",
        "documentation": "operational",
      },
    });
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(null) // tenant message
      .mockResolvedValueOnce(JSON.stringify(overall));

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(body.status).toBe("degraded");
    expect(body.services["dashboard"]).toBe("degraded");
    expect(body.services["edge-delivery"]).toBe("down");
  });

  it("reads from KV with the tenant-scoped key", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    await app.request("/api/status", {}, env);

    expect(env.STATUS_KV.get).toHaveBeenCalledWith(KV_KEYS.tenantOverall(TEST_TENANT.id));
  });

  it("includes message when tenant message is set in KV", async () => {
    const message = { text: "Scheduled maintenance tonight", updatedAt: "2026-03-08T12:00:00.000Z" };
    const overall = mockOverallStatus();
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(JSON.stringify(message)) // tenant message
      .mockResolvedValueOnce(JSON.stringify(overall)); // overall

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toEqual(message);
  });

  it("has null message when tenant message is not set", async () => {
    const overall = mockOverallStatus();
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(null) // tenant message
      .mockResolvedValueOnce(JSON.stringify(overall));

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBeNull();
  });
});

describe("PUT /api/status/message", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(async () => {
    TEST_API_KEY_HASH = await computeHash(TEST_API_KEY);
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
    mockD1ForApiKey(env);
  });

  it("stores message with valid auth and valid text", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADER,
      },
      body: JSON.stringify({ text: "Scheduled maintenance" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantMessage(TEST_TENANT.id),
      expect.stringContaining("Scheduled maintenance"),
    );
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ text: "Hello" }),
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 for empty text", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADER,
      },
      body: JSON.stringify({ text: "" }),
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid parameters");
  });

  it("returns 400 for text exceeding 500 characters", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADER,
      },
      body: JSON.stringify({ text: "a".repeat(501) }),
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid parameters");
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADER,
      },
      body: "not json{{{",
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("trims whitespace from text before storing", async () => {
    await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADER,
      },
      body: JSON.stringify({ text: "  trimmed  " }),
    }, env);

    const putCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => (call[0] as string) === KV_KEYS.tenantMessage(TEST_TENANT.id),
    );
    expect(putCalls.length).toBe(1);
    const stored = JSON.parse(putCalls[0][1] as string);
    expect(stored.text).toBe("trimmed");
  });

  it("stores updatedAt timestamp with the message", async () => {
    await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...AUTH_HEADER,
      },
      body: JSON.stringify({ text: "Maintenance" }),
    }, env);

    const putCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => (call[0] as string) === KV_KEYS.tenantMessage(TEST_TENANT.id),
    );
    const stored = JSON.parse(putCalls[0][1] as string);
    expect(stored.updatedAt).toBeDefined();
    expect(new Date(stored.updatedAt).getTime()).not.toBeNaN();
  });
});

describe("DELETE /api/status/message", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(async () => {
    TEST_API_KEY_HASH = await computeHash(TEST_API_KEY);
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
    mockD1ForApiKey(env);
  });

  it("deletes message with valid auth", async () => {
    const res = await app.request("/api/status/message", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(env.STATUS_KV.delete).toHaveBeenCalledWith(KV_KEYS.tenantMessage(TEST_TENANT.id));
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.request("/api/status/message", {
      method: "DELETE",
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.request("/api/status/message", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer wrong-key",
      },
    }, env);

    expect(res.status).toBe(401);
  });
});

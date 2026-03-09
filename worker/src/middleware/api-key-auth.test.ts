import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { Env, Tenant } from "../types";
import { requireApiKey, requireScope } from "./api-key-auth";
import { createMockEnv } from "../test-helpers";

// Pre-computed SHA-256 hash of "os_test_abc123def456"
// We compute it at test time to avoid hardcoding
let TEST_TOKEN_HASH: string;

const MOCK_TENANT: Tenant = {
  id: "tenant-abc-123",
  name: "Acme Corp",
  slug: "acme",
  plan: "pro",
  ownerId: "user-1",
  customDomain: null,
  customDomainStatus: "none",
  brandingLogoUrl: null,
  brandingColor: "#3B82F6",
  brandingShowBadge: true,
  createdAt: "2026-03-08T12:00:00.000Z",
};

const TEST_TOKEN = "os_test_abc123def456";

async function computeHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function createMockApiKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "key-1",
    tenant_id: MOCK_TENANT.id,
    name: "Test Key",
    key_hash: TEST_TOKEN_HASH,
    key_prefix: "os_test_abc1",
    scopes: JSON.stringify(["read:status", "write:incidents"]),
    last_used_at: null,
    expires_at: null,
    created_at: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

function createApp(env: Env) {
  const app = new Hono<{
    Bindings: Env;
    Variables: { tenant: Tenant; apiKeyScopes: string[] };
  }>();

  // Inject tenant (simulates resolveTenant running first)
  app.use("/*", async (c, next) => {
    c.set("tenant", MOCK_TENANT);
    return next();
  });

  app.get("/api/protected", requireApiKey, (c) => {
    const scopes = c.get("apiKeyScopes");
    return c.json({ ok: true, scopes });
  });

  app.get(
    "/api/scoped",
    requireApiKey,
    requireScope("write:incidents"),
    (c) => c.json({ ok: true }),
  );

  app.get(
    "/api/admin-only",
    requireApiKey,
    requireScope("admin:manage"),
    (c) => c.json({ ok: true }),
  );

  return app;
}

describe("requireApiKey middleware", () => {
  let env: Env;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    TEST_TOKEN_HASH = await computeHash(TEST_TOKEN);

    const mockRow = createMockApiKeyRow();

    const d1 = createMockD1WithApiKey(mockRow);
    env = createMockEnv({ STATUS_DB: d1 });
    app = createApp(env);
  });

  it("authenticates valid API key", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; scopes: string[] };
    expect(body.ok).toBe(true);
    expect(body.scopes).toEqual(["read:status", "write:incidents"]);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/protected", {}, env);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong format", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Basic dGVzdDp0ZXN0" },
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when token is invalid (not in DB)", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer wrong-token-value" },
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Bearer token is empty", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer " },
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 when API key is expired", async () => {
    const expiredRow = createMockApiKeyRow({
      expires_at: "2020-01-01T00:00:00.000Z",
    });
    const d1 = createMockD1WithApiKey(expiredRow);
    env = createMockEnv({ STATUS_DB: d1 });
    app = createApp(env);

    const res = await app.request("/api/protected", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("API key expired");
  });

  it("allows non-expired API key with future expires_at", async () => {
    const futureRow = createMockApiKeyRow({
      expires_at: "2099-12-31T23:59:59.000Z",
    });
    const d1 = createMockD1WithApiKey(futureRow);
    env = createMockEnv({ STATUS_DB: d1 });
    app = createApp(env);

    const res = await app.request("/api/protected", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    expect(res.status).toBe(200);
  });

  it("allows API key with null expires_at (never expires)", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    expect(res.status).toBe(200);
  });

  it("updates last_used_at in background", async () => {
    const d1 = createMockD1WithApiKey(createMockApiKeyRow());
    env = createMockEnv({ STATUS_DB: d1 });
    app = createApp(env);

    await app.request("/api/protected", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    // The UPDATE query should have been prepared
    const prepareCalls = (d1.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const updateCall = prepareCalls.find(
      ([q]: [string]) => typeof q === "string" && q.includes("UPDATE"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain("last_used_at");
  });
});

describe("requireScope middleware", () => {
  let env: Env;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    TEST_TOKEN_HASH = await computeHash(TEST_TOKEN);
    const d1 = createMockD1WithApiKey(createMockApiKeyRow());
    env = createMockEnv({ STATUS_DB: d1 });
    app = createApp(env);
  });

  it("allows request when key has required scope", async () => {
    const res = await app.request("/api/scoped", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    expect(res.status).toBe(200);
  });

  it("returns 403 when key lacks required scope", async () => {
    const res = await app.request("/api/admin-only", {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    }, env);

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; message: string };
    expect(body.error).toBe("Forbidden");
    expect(body.message).toContain("admin:manage");
  });
});

// --- Helper: Create a D1 mock that returns the given row for api_keys queries ---

function createMockD1WithApiKey(apiKeyRow: Record<string, unknown> | null) {
  const d1 = createMockEnv().STATUS_DB;
  const originalPrepare = d1.prepare;

  d1.prepare = vi.fn((query: string) => {
    const stmt = (originalPrepare as (q: string) => ReturnType<D1Database["prepare"]>)(query);
    const originalBind = stmt.bind;

    stmt.bind = (...values: unknown[]) => {
      const bound = (originalBind as (...v: unknown[]) => typeof stmt)(...values);

      if (query.includes("FROM api_keys")) {
        // Only return the row if the hash matches
        bound.first = async () => {
          if (!apiKeyRow) return null;
          const queryHash = values[0] as string;
          const storedHash = apiKeyRow["key_hash"] as string;
          if (queryHash === storedHash) return apiKeyRow;
          return null;
        };
      }

      return bound;
    };

    return stmt;
  });

  return d1;
}

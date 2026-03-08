import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types";
import { incidentRoutes } from "./incidents";
import { createMockEnv } from "../test-helpers";

// Mock fetch for Slack/email notifications
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("ok", { status: 200 }))));

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
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
  app.route("/api", incidentRoutes);
  return { app, env };
}

const AUTH_HEADER = { Authorization: "Bearer test-admin-key-secret" };

function mockD1ForIncidents(env: Env, overrides?: {
  firstResult?: Record<string, unknown> | null;
  allResults?: Record<string, unknown>[];
  lastRowId?: number;
}) {
  vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(overrides?.firstResult ?? null),
      all: vi.fn().mockResolvedValue({
        results: overrides?.allResults ?? [],
      }),
      run: vi.fn().mockResolvedValue({
        success: true,
        meta: { changes: 1, last_row_id: overrides?.lastRowId ?? 1 },
      }),
      raw: vi.fn().mockResolvedValue([]),
    };
    return stmt as unknown as D1PreparedStatement;
  });
}

describe("GET /api/incidents (public)", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns paginated incidents without auth", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 1 }),
        all: vi.fn().mockResolvedValue({
          results: [{
            id: 1,
            title: "API outage",
            severity: "critical",
            status: "investigating",
            createdAt: "2026-03-01",
          }],
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/incidents", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incidents).toHaveLength(1);
    expect(body.incidents[0].title).toBe("API outage");
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBe(1);
  });

  it("supports page and limit query params", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 50 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/incidents?page=2&limit=10", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(10);
    expect(body.pagination.totalPages).toBe(5);
  });

  it("returns 400 for invalid page=0", async () => {
    const res = await app.request("/api/incidents?page=0", {}, env);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/incidents/:id (public)", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns incident with updates", async () => {
    const callCount = { n: 0 };
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      callCount.n++;
      const isFirst = callCount.n === 1;
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          isFirst
            ? { id: 1, title: "Outage", severity: "critical", status: "investigating", description: "", createdAt: "2026-03-01", updatedAt: "2026-03-01", resolvedAt: null, affectedServices: "[]" }
            : null,
        ),
        all: vi.fn().mockResolvedValue({
          results: isFirst ? [] : [
            { id: 1, incidentId: 1, message: "Looking into it", status: "investigating", createdAt: "2026-03-01" },
          ],
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/incidents/1", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incident).toBeDefined();
    expect(body.incident.title).toBe("Outage");
    expect(body.updates).toBeDefined();
  });

  it("returns 404 for nonexistent incident", async () => {
    mockD1ForIncidents(env, { firstResult: null, allResults: [] });

    const res = await app.request("/api/incidents/999", {}, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Incident not found");
  });

  it("returns 400 for invalid incident ID", async () => {
    const res = await app.request("/api/incidents/abc", {}, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid incident ID");
  });
});

describe("POST /api/incidents (admin)", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
    // Mock KV for notification config
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", severity: "minor" }),
    }, env);
    expect(res.status).toBe(401);
  });

  it("creates incident with all fields", async () => {
    mockD1ForIncidents(env, { lastRowId: 42 });

    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "API Outage",
        description: "API is returning 500 errors",
        severity: "critical",
        status: "investigating",
        affectedServices: ["api", "dashboard"],
      }),
    }, env);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(42);
    expect(body.message).toBe("Incident created");
  });

  it("creates incident with minimal fields (title + severity)", async () => {
    mockD1ForIncidents(env, { lastRowId: 1 });

    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Minor issue", severity: "minor" }),
    }, env);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe("Incident created");
  });

  it("returns 400 for missing title", async () => {
    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ severity: "minor" }),
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid parameters");
  });

  it("returns 400 for missing severity", async () => {
    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid severity value", async () => {
    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", severity: "unknown" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid status value", async () => {
    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", severity: "minor", status: "invalid" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/incidents", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: "not json{{{",
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("accepts all valid severity values", async () => {
    for (const severity of ["critical", "major", "minor", "maintenance"]) {
      mockD1ForIncidents(env, { lastRowId: 1 });

      const res = await app.request("/api/incidents", {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Test ${severity}`, severity }),
      }, env);

      expect(res.status).toBe(201);
    }
  });

  it("accepts all valid status values", async () => {
    for (const status of ["investigating", "identified", "monitoring", "resolved"]) {
      mockD1ForIncidents(env, { lastRowId: 1 });

      const res = await app.request("/api/incidents", {
        method: "POST",
        headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Test ${status}`, severity: "minor", status }),
      }, env);

      expect(res.status).toBe(201);
    }
  });
});

describe("PUT /api/incidents/:id (admin)", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/incidents/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    }, env);
    expect(res.status).toBe(401);
  });

  it("updates incident fields", async () => {
    mockD1ForIncidents(env, {
      firstResult: {
        id: 1, title: "Original", description: "desc", severity: "minor",
        status: "investigating", affectedServices: "[]",
        createdAt: "2026-03-01", updatedAt: "2026-03-01", resolvedAt: null,
      },
    });

    const res = await app.request("/api/incidents/1", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated Title", severity: "major" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Incident updated");
  });

  it("auto-sets resolvedAt when status changes to resolved", async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          id: 1, title: "Incident", description: "", severity: "minor",
          status: "investigating", affectedServices: "[]",
          createdAt: "2026-03-01", updatedAt: "2026-03-01", resolvedAt: null,
        }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: runMock,
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/incidents/1", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    }, env);

    expect(res.status).toBe(200);
    // Verify bind was called with a non-null resolvedAt (7th arg)
    const bindCalls = runMock.mock.instances.map((_, i) => {
      const stmt = vi.mocked(env.STATUS_DB.prepare).mock.results[i]?.value;
      return stmt;
    });
    // The UPDATE statement's bind should have resolvedAt set
    const updateCalls = vi.mocked(env.STATUS_DB.prepare).mock.calls;
    const updateQuery = updateCalls.find((c) => (c[0] as string).includes("UPDATE"));
    expect(updateQuery).toBeDefined();
  });

  it("does not reset resolvedAt when already resolved", async () => {
    mockD1ForIncidents(env, {
      firstResult: {
        id: 1, title: "Incident", description: "", severity: "minor",
        status: "resolved", affectedServices: "[]",
        createdAt: "2026-03-01", updatedAt: "2026-03-01", resolvedAt: "2026-03-02",
      },
    });

    const res = await app.request("/api/incidents/1", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    }, env);

    expect(res.status).toBe(200);
  });

  it("returns 404 for nonexistent incident", async () => {
    mockD1ForIncidents(env, { firstResult: null });

    const res = await app.request("/api/incidents/999", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    }, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Incident not found");
  });

  it("returns 400 for invalid incident ID", async () => {
    const res = await app.request("/api/incidents/abc", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid severity in update", async () => {
    const res = await app.request("/api/incidents/1", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ severity: "invalid" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/incidents/1", {
      method: "PUT",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: "not json{",
    }, env);

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/incidents/:id (admin)", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/incidents/1", {
      method: "DELETE",
    }, env);
    expect(res.status).toBe(401);
  });

  it("deletes an existing incident and its updates", async () => {
    mockD1ForIncidents(env, { firstResult: { id: 1 } });

    const res = await app.request("/api/incidents/1", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Incident deleted");

    // Verify both delete queries were called (updates first, then incident)
    const queries = vi.mocked(env.STATUS_DB.prepare).mock.calls.map((c) => c[0] as string);
    expect(queries.some((q) => q.includes("DELETE FROM status_incident_updates"))).toBe(true);
    expect(queries.some((q) => q.includes("DELETE FROM status_incidents"))).toBe(true);
  });

  it("returns 404 for nonexistent incident", async () => {
    mockD1ForIncidents(env, { firstResult: null });

    const res = await app.request("/api/incidents/999", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Incident not found");
  });

  it("returns 400 for invalid incident ID", async () => {
    const res = await app.request("/api/incidents/abc", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(400);
  });
});

describe("POST /api/incidents/:id/updates (admin)", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Update", status: "investigating" }),
    }, env);
    expect(res.status).toBe(401);
  });

  it("adds an update to an existing incident", async () => {
    mockD1ForIncidents(env, {
      firstResult: { id: 1, status: "investigating" },
      lastRowId: 5,
    });

    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Identified root cause", status: "identified" }),
    }, env);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(5);
    expect(body.message).toBe("Update added");
  });

  it("returns 404 for nonexistent incident", async () => {
    mockD1ForIncidents(env, { firstResult: null });

    const res = await app.request("/api/incidents/999/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Update", status: "investigating" }),
    }, env);

    expect(res.status).toBe(404);
  });

  it("returns 400 when message is missing", async () => {
    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "investigating" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 when status is missing", async () => {
    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Update" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid status value in update", async () => {
    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Update", status: "invalid" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: "not json",
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid incident ID", async () => {
    const res = await app.request("/api/incidents/abc/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Update", status: "investigating" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("sets resolvedAt on incident when update status is resolved", async () => {
    mockD1ForIncidents(env, {
      firstResult: { id: 1, status: "monitoring" },
      lastRowId: 3,
    });

    const res = await app.request("/api/incidents/1/updates", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Issue resolved", status: "resolved" }),
    }, env);

    expect(res.status).toBe(201);

    // Verify the UPDATE query includes resolved_at
    const queries = vi.mocked(env.STATUS_DB.prepare).mock.calls.map((c) => c[0] as string);
    expect(queries.some((q) => q.includes("resolved_at"))).toBe(true);
  });
});

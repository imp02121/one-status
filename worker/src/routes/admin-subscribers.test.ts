import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types";
import { adminSubscriberRoutes } from "./admin-subscribers";
import { createMockEnv } from "../test-helpers";

// Mock fetch for email sending (Resend API)
vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("ok", { status: 200 }))));

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  // No content-type middleware here — we add it to match production behavior
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
  app.route("/api", adminSubscriberRoutes);
  return { app, env };
}

const AUTH_HEADER = { Authorization: "Bearer test-admin-key-secret" };

describe("GET /api/admin/subscribers", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.request("/api/admin/subscribers", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.request("/api/admin/subscribers", {
      headers: { Authorization: "Bearer wrong" },
    }, env);
    expect(res.status).toBe(401);
  });

  it("returns paginated subscriber list", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation((query: string) => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 2 }),
        all: vi.fn().mockResolvedValue({
          results: [
            { id: 1, email: "a@test.com", verified: 1, createdAt: "2026-01-01" },
            { id: 2, email: "b@test.com", verified: 0, createdAt: "2026-01-02" },
          ],
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscribers).toHaveLength(2);
    expect(body.subscribers[0].verified).toBe(true);
    expect(body.subscribers[1].verified).toBe(false);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.page).toBe(1);
  });

  it("accepts page and limit query params", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 100 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 0 } }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers?page=3&limit=10", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.page).toBe(3);
    expect(body.pagination.limit).toBe(10);
    expect(body.pagination.totalPages).toBe(10);
  });

  it("filters by verified=true", async () => {
    const prepareSpy = vi.fn().mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 5 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(prepareSpy);

    const res = await app.request("/api/admin/subscribers?verified=true", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    // Verify the WHERE clause includes verified filter
    const queries = prepareSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(queries.some((q: string) => q.includes("WHERE verified = 1"))).toBe(true);
  });

  it("filters by verified=false", async () => {
    const prepareSpy = vi.fn().mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 3 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(prepareSpy);

    const res = await app.request("/api/admin/subscribers?verified=false", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const queries = prepareSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(queries.some((q: string) => q.includes("WHERE verified = 0"))).toBe(true);
  });

  it("returns 400 for invalid page parameter", async () => {
    const res = await app.request("/api/admin/subscribers?page=0", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for limit exceeding max (100)", async () => {
    const res = await app.request("/api/admin/subscribers?limit=101", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/subscribers/count", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/subscribers/count", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns total, verified, and unverified counts", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ total: 10, verifiedCount: 7, unverifiedCount: 3 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers/count", {
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(10);
    expect(body.verified).toBe(7);
    expect(body.unverified).toBe(3);
  });

  it("returns zeros when no subscribers exist", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers/count", {
      headers: AUTH_HEADER,
    }, env);

    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.verified).toBe(0);
    expect(body.unverified).toBe(0);
  });
});

describe("DELETE /api/admin/subscribers/:id", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/subscribers/1", {
      method: "DELETE",
    }, env);
    expect(res.status).toBe(401);
  });

  it("deletes an existing subscriber", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1 }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers/1", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Subscriber removed");
  });

  it("returns 404 for nonexistent subscriber", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers/999", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Subscriber not found");
  });

  it("returns 400 for invalid subscriber ID", async () => {
    const res = await app.request("/api/admin/subscribers/abc", {
      method: "DELETE",
      headers: AUTH_HEADER,
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid subscriber ID");
  });
});

describe("POST /api/admin/subscribers/notify", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
    vi.mocked(fetch).mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/admin/subscribers/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Test", html: "<p>Hi</p>" }),
    }, env);
    expect(res.status).toBe(401);
  });

  it("sends notification to verified subscribers", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({
          results: [{ email: "a@test.com" }, { email: "b@test.com" }],
        }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers/notify", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Test Subject", html: "<p>Hello</p>" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Notifications sent");
    expect(body.sent).toBe(2);
  });

  it("returns sent=0 when no verified subscribers exist", async () => {
    vi.mocked(env.STATUS_DB.prepare).mockImplementation(() => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true, meta: {} }),
        raw: vi.fn().mockResolvedValue([]),
      };
      return stmt as unknown as D1PreparedStatement;
    });

    const res = await app.request("/api/admin/subscribers/notify", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Test", html: "<p>Hi</p>" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
  });

  it("returns 400 for missing subject", async () => {
    const res = await app.request("/api/admin/subscribers/notify", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<p>Hello</p>" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing html", async () => {
    const res = await app.request("/api/admin/subscribers/notify", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Test" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/admin/subscribers/notify", {
      method: "POST",
      headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
      body: "not json{{{",
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });
});

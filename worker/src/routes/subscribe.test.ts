import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types";
import { subscribeRoutes } from "./subscribe";
import { createMockEnv } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api", subscribeRoutes);
  return app;
}

describe("POST /api/subscribe", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "email-123" }), { status: 200 }),
    );

    env = createMockEnv();
    app = createApp(env);
  });

  it("creates subscriber with valid email", async () => {
    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Subscription received");
  });

  it("calls D1 INSERT for new subscribers", async () => {
    await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    }, env);

    expect(env.STATUS_DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO status_subscribers"),
    );
  });

  it("sends verification email via Resend", async () => {
    await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    }, env);

    // Should have called Resend API
    const resendCalls = vi.mocked(fetch).mock.calls.filter(
      (call) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString();
        return url.includes("api.resend.com");
      },
    );
    expect(resendCalls.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid email");
  });

  it("returns 400 for missing email field", async () => {
    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for empty string email", async () => {
    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "" }),
    }, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("handles already-verified subscriber gracefully", async () => {
    // Mock D1 to return an existing verified subscriber
    const db = createMockD1WithExistingSubscriber(true);
    env = createMockEnv({ STATUS_DB: db });
    app = createApp(env);

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "existing@example.com" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Already subscribed");
  });

  it("re-sends verification for unverified existing subscriber", async () => {
    // Mock D1 to return unverified subscriber
    const db = createMockD1WithExistingSubscriber(false);
    env = createMockEnv({ STATUS_DB: db });
    app = createApp(env);

    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unverified@example.com" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Subscription received");
  });

  it("returns success message with instructions", async () => {
    const res = await app.request("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    }, env);

    const body = await res.json();
    expect(body.message).toContain("Check your email");
  });
});

describe("GET /api/verify", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    app = createApp(env);
  });

  it("verifies subscriber with valid token", async () => {
    // Mock D1 to return subscriber for verify_token query
    const mockDB = createMockD1WithVerifyToken("valid-token-123");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    const res = await app.request("/api/verify?token=valid-token-123", {}, env);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("verified");
  });

  it("returns 400 when token parameter is missing", async () => {
    const res = await app.request("/api/verify", {}, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing verification token");
  });

  it("returns 404 for unknown token", async () => {
    const res = await app.request("/api/verify?token=unknown", {}, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Invalid or expired");
  });

  it("returns HTML response on successful verification", async () => {
    const mockDB = createMockD1WithVerifyToken("valid-token");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    const res = await app.request("/api/verify?token=valid-token", {}, env);

    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

// Helper to create D1 mock with existing subscriber
function createMockD1WithExistingSubscriber(verified: boolean): D1Database {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    first: vi.fn().mockResolvedValue({ id: 42, verified: verified ? 1 : 0 }),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    raw: vi.fn().mockResolvedValue([]),
  };

  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function createMockD1WithVerifyToken(expectedToken: string): D1Database {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    first: vi.fn().mockImplementation(async () => {
      // Check if bound with expected token
      const boundArgs = stmt.bind.mock.calls;
      const lastCall = boundArgs[boundArgs.length - 1];
      if (lastCall && lastCall[0] === expectedToken) {
        return { id: 1 };
      }
      return null;
    }),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
    raw: vi.fn().mockResolvedValue([]),
  };

  return {
    prepare: vi.fn(() => stmt),
    batch: vi.fn(),
    exec: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types";
import { unsubscribeRoutes } from "./unsubscribe";
import { createMockEnv } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api", unsubscribeRoutes);
  return app;
}

describe("GET /api/unsubscribe", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    app = createApp(env);
  });

  it("unsubscribes user with valid token", async () => {
    const mockDB = createMockD1WithUnsubToken("valid-unsub-token");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    const res = await app.request(
      "/api/unsubscribe?token=valid-unsub-token",
      {},
      env,
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("unsubscribed");
    expect(text).toContain("BundleNudge");
  });

  it("returns HTML response (not JSON)", async () => {
    const mockDB = createMockD1WithUnsubToken("token-123");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    const res = await app.request(
      "/api/unsubscribe?token=token-123",
      {},
      env,
    );

    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("returns 400 when token parameter is missing", async () => {
    const res = await app.request("/api/unsubscribe", {}, env);

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Missing unsubscribe token");
  });

  it("returns 404 for unknown token", async () => {
    const res = await app.request(
      "/api/unsubscribe?token=nonexistent",
      {},
      env,
    );

    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("Invalid or expired");
  });

  it("deletes subscriber from D1 on valid unsubscribe", async () => {
    const mockDB = createMockD1WithUnsubToken("valid-token");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    await app.request("/api/unsubscribe?token=valid-token", {}, env);

    expect(mockDB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM status_subscribers"),
    );
  });

  it("returns success HTML with green status color", async () => {
    const mockDB = createMockD1WithUnsubToken("good-token");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    const res = await app.request(
      "/api/unsubscribe?token=good-token",
      {},
      env,
    );

    const text = await res.text();
    expect(text).toContain("#22c55e"); // green
  });

  it("returns error HTML with red status color on invalid token", async () => {
    const res = await app.request(
      "/api/unsubscribe?token=bad-token",
      {},
      env,
    );

    const text = await res.text();
    expect(text).toContain("#ef4444"); // red
  });

  it("includes link back to status page", async () => {
    const mockDB = createMockD1WithUnsubToken("token");
    env = createMockEnv({ STATUS_DB: mockDB });
    app = createApp(env);

    const res = await app.request(
      "/api/unsubscribe?token=token",
      {},
      env,
    );

    const text = await res.text();
    expect(text).toContain("https://status.bundlenudge.com");
    expect(text).toContain("Back to status page");
  });
});

function createMockD1WithUnsubToken(expectedToken: string): D1Database {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    first: vi.fn().mockImplementation(async () => {
      const boundArgs = stmt.bind.mock.calls;
      const lastCall = boundArgs[boundArgs.length - 1];
      if (lastCall && lastCall[0] === expectedToken) {
        return { id: 1, email: "test@example.com" };
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

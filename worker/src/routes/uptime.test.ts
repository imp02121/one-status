import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env, DailyUptime } from "../types";
import { uptimeRoutes } from "./uptime";
import { createMockEnv, mockDailyUptime } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api", uptimeRoutes);
  return app;
}

describe("GET /api/uptime", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    app = createApp(env);
  });

  it("returns uptime data for valid service name", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(
      JSON.stringify(mockDailyUptime()),
    );

    const res = await app.request("/api/uptime?service=api&days=3", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe("api");
    expect(body.days).toBe(3);
    expect(body.entries).toHaveLength(3);
  });

  it("returns default 90 days when days parameter is omitted", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/uptime?service=api", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(90);
    expect(body.entries).toHaveLength(90);
  });

  it("respects custom days parameter", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/uptime?service=documentation&days=7", {}, env);
    const body = await res.json();

    expect(body.days).toBe(7);
    expect(body.entries).toHaveLength(7);
  });

  it("returns 400 for invalid service name", async () => {
    const res = await app.request(
      "/api/uptime?service=nonexistent",
      {},
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 for missing service parameter", async () => {
    const res = await app.request("/api/uptime", {}, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 for days greater than 90", async () => {
    const res = await app.request(
      "/api/uptime?service=api&days=100",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for days less than 1", async () => {
    const res = await app.request(
      "/api/uptime?service=api&days=0",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for negative days", async () => {
    const res = await app.request(
      "/api/uptime?service=api&days=-5",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns null uptime for days with no KV data", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/uptime?service=api&days=3", {}, env);
    const body = await res.json();

    for (const entry of body.entries) {
      expect(entry.uptime).toBeNull();
    }
  });

  it("returns uptime data with correct date format", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/uptime?service=api&days=1", {}, env);
    const body = await res.json();

    expect(body.entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts all valid service names", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const services = [
      "api",
      "dashboard",
      "authentication",
      "edge-delivery",
      "ota-updates",
      "build-service",
      "documentation",
    ];

    for (const service of services) {
      const res = await app.request(
        `/api/uptime?service=${service}&days=1`,
        {},
        env,
      );
      expect(res.status).toBe(200);
    }
  });

  it("returns parsed uptime data when KV has entries", async () => {
    const uptime = mockDailyUptime({
      totalChecks: 100,
      operationalChecks: 95,
      degradedChecks: 3,
      downChecks: 2,
      uptimePercent: 98,
    });
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(JSON.stringify(uptime));

    const res = await app.request("/api/uptime?service=api&days=1", {}, env);
    const body = await res.json();

    expect(body.entries[0].uptime).toEqual(uptime);
  });
});

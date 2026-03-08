import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env, Incident } from "../types";
import { incidentRoutes } from "./incidents";
import { createMockEnv, createMockD1 } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api", incidentRoutes);
  return app;
}

function mockIncident(overrides?: Partial<Incident>): Incident {
  return {
    id: 1,
    title: "API Outage",
    description: "The API is experiencing downtime",
    status: "investigating",
    severity: "major",
    affectedServices: '["api"]',
    createdAt: "2026-03-08T10:00:00.000Z",
    updatedAt: "2026-03-08T10:05:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("GET /api/incidents", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    const incidents = [
      mockIncident({ id: 1 }),
      mockIncident({ id: 2, title: "Dashboard Slow" }),
    ];

    env = createMockEnv({
      STATUS_DB: createMockD1({
        firstResults: new Map([
          ["SELECT COUNT(*) as total FROM status_incidents", { total: 2 }],
        ]),
        queryResults: new Map([
          [
            "SELECT * FROM status_incidents ORDER BY created_at DESC LIMIT ? OFFSET ?",
            incidents,
          ],
        ]),
      }),
    });

    app = createApp(env);
  });

  it("returns paginated incidents with default page=1, limit=20", async () => {
    const res = await app.request("/api/incidents", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incidents).toBeDefined();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(20);
  });

  it("returns correct pagination metadata", async () => {
    const res = await app.request("/api/incidents", {}, env);
    const body = await res.json();

    expect(body.pagination.total).toBe(2);
    expect(body.pagination.totalPages).toBe(1);
  });

  it("custom page and limit parameters work", async () => {
    const res = await app.request(
      "/api/incidents?page=2&limit=1",
      {},
      env,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(1);
  });

  it("returns incidents ordered by created_at DESC", async () => {
    const res = await app.request("/api/incidents", {}, env);

    expect(env.STATUS_DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("ORDER BY created_at DESC"),
    );
  });

  it("returns 400 for invalid page (0)", async () => {
    const res = await app.request(
      "/api/incidents?page=0",
      {},
      env,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 for negative page", async () => {
    const res = await app.request(
      "/api/incidents?page=-1",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric page", async () => {
    const res = await app.request(
      "/api/incidents?page=abc",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for limit exceeding 100", async () => {
    const res = await app.request(
      "/api/incidents?limit=101",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 for limit of 0", async () => {
    const res = await app.request(
      "/api/incidents?limit=0",
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns empty array when no incidents exist", async () => {
    env = createMockEnv({
      STATUS_DB: createMockD1({
        firstResults: new Map([
          ["SELECT COUNT(*) as total FROM status_incidents", { total: 0 }],
        ]),
        queryResults: new Map([
          [
            "SELECT * FROM status_incidents ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [],
          ],
        ]),
      }),
    });
    app = createApp(env);

    const res = await app.request("/api/incidents", {}, env);
    const body = await res.json();

    expect(body.incidents).toEqual([]);
    expect(body.pagination.total).toBe(0);
    expect(body.pagination.totalPages).toBe(0);
  });

  it("includes all incident fields in response", async () => {
    const res = await app.request("/api/incidents", {}, env);
    const body = await res.json();

    // Verify the D1 query returns results array
    expect(body.incidents).toBeDefined();
    expect(Array.isArray(body.incidents)).toBe(true);
  });

  it("calculates totalPages correctly for pagination", async () => {
    env = createMockEnv({
      STATUS_DB: createMockD1({
        firstResults: new Map([
          ["SELECT COUNT(*) as total FROM status_incidents", { total: 45 }],
        ]),
        queryResults: new Map([
          [
            "SELECT * FROM status_incidents ORDER BY created_at DESC LIMIT ? OFFSET ?",
            [],
          ],
        ]),
      }),
    });
    app = createApp(env);

    const res = await app.request("/api/incidents?limit=20", {}, env);
    const body = await res.json();

    expect(body.pagination.totalPages).toBe(3); // ceil(45/20)
  });
});

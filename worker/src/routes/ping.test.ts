import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types";
import { pingRoutes } from "./ping";
import { createMockEnv } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api", pingRoutes);
  return { app, env };
}

describe("GET /api/ping", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("returns 200 with ok: true", async () => {
    const res = await app.request("/api/ping", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("includes a timestamp in the response", async () => {
    const res = await app.request("/api/ping", {}, env);
    const body = await res.json();

    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it("does not require authentication", async () => {
    // No Authorization header — should still succeed
    const res = await app.request("/api/ping", {}, env);
    expect(res.status).toBe(200);
  });
});

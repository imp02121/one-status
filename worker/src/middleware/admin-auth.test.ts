import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../types";
import { requireAdmin } from "./admin-auth";
import { createMockEnv } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.get("/api/protected", requireAdmin, (c) => c.json({ ok: true }));
  return { app, env };
}

describe("requireAdmin middleware", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("allows request with valid Bearer token", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer test-admin-key-secret" },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/protected", {}, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong format", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Basic dGVzdDp0ZXN0" },
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when token is incorrect", async () => {
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer wrong-token" },
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when ADMIN_API_KEY is empty string", async () => {
    env = createMockEnv({ ADMIN_API_KEY: "" });
    const setup = createApp(env);
    app = setup.app;

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer " },
    }, env);

    expect(res.status).toBe(401);
  });

  it("returns 401 when token has expired (ADMIN_TOKEN_EXPIRES_AT in the past)", async () => {
    env = createMockEnv({ ADMIN_TOKEN_EXPIRES_AT: "2020-01-01T00:00:00.000Z" });
    const setup = createApp(env);
    app = setup.app;

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer test-admin-key-secret" },
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Token expired");
  });

  it("allows request when ADMIN_TOKEN_EXPIRES_AT is in the future", async () => {
    env = createMockEnv({ ADMIN_TOKEN_EXPIRES_AT: "2099-12-31T23:59:59.000Z" });
    const setup = createApp(env);
    app = setup.app;

    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer test-admin-key-secret" },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("allows request when ADMIN_TOKEN_EXPIRES_AT is not set (no expiry)", async () => {
    // Default createMockEnv does not set ADMIN_TOKEN_EXPIRES_AT
    const res = await app.request("/api/protected", {
      headers: { Authorization: "Bearer test-admin-key-secret" },
    }, env);

    expect(res.status).toBe(200);
  });
});

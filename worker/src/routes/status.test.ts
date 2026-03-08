import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Env, OverallStatus, LatestStatus } from "../types";
import { KV_KEYS, SERVICE_NAMES } from "../types";
import { statusRoutes } from "./status";
import { createMockEnv, mockOverallStatus, mockLatestStatus } from "../test-helpers";

function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api", statusRoutes);
  return { app, env };
}

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
      .mockResolvedValueOnce(null) // status:message
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
      .mockResolvedValueOnce(null) // status:message
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

  it("falls back to individual service statuses when overall KV is empty", async () => {
    // First call returns null for overall
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === KV_KEYS.overall) return null;
      // Return individual service status
      if (key.startsWith("health:")) {
        const service = key.replace("health:", "").replace(":latest", "");
        return JSON.stringify(
          mockLatestStatus(service as any, { status: "operational" }),
        );
      }
      return null;
    });

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("unknown");
    expect(body.services).toBeDefined();
  });

  it("returns null for services with no KV data in fallback mode", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("unknown");
    for (const service of SERVICE_NAMES) {
      expect(body.services[service]).toBeNull();
    }
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
      .mockResolvedValueOnce(null) // status:message
      .mockResolvedValueOnce(JSON.stringify(overall));

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(body.status).toBe("degraded");
    expect(body.services["dashboard"]).toBe("degraded");
    expect(body.services["edge-delivery"]).toBe("down");
  });

  it("reads from KV with the correct key", async () => {
    vi.mocked(env.STATUS_KV.get).mockResolvedValue(null);

    await app.request("/api/status", {}, env);

    expect(env.STATUS_KV.get).toHaveBeenCalledWith(KV_KEYS.overall);
  });

  it("includes message when status:message is set in KV", async () => {
    const message = { text: "Scheduled maintenance tonight", updatedAt: "2026-03-08T12:00:00.000Z" };
    const overall = mockOverallStatus();
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(JSON.stringify(message)) // status:message
      .mockResolvedValueOnce(JSON.stringify(overall)); // overall

    const res = await app.request("/api/status", {}, env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toEqual(message);
  });

  it("has null message when status:message is not set", async () => {
    const overall = mockOverallStatus();
    vi.mocked(env.STATUS_KV.get)
      .mockResolvedValueOnce(null) // status:message
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

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("stores message with valid auth and valid text", async () => {
    const res = await app.request("/api/status/message", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-admin-key-secret",
      },
      body: JSON.stringify({ text: "Scheduled maintenance" }),
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      "status:message",
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
        Authorization: "Bearer test-admin-key-secret",
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
        Authorization: "Bearer test-admin-key-secret",
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
        Authorization: "Bearer test-admin-key-secret",
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
        Authorization: "Bearer test-admin-key-secret",
      },
      body: JSON.stringify({ text: "  trimmed  " }),
    }, env);

    const putCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === "status:message",
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
        Authorization: "Bearer test-admin-key-secret",
      },
      body: JSON.stringify({ text: "Maintenance" }),
    }, env);

    const putCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === "status:message",
    );
    const stored = JSON.parse(putCalls[0][1] as string);
    expect(stored.updatedAt).toBeDefined();
    expect(new Date(stored.updatedAt).getTime()).not.toBeNaN();
  });
});

describe("DELETE /api/status/message", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    env = createMockEnv();
    const setup = createApp(env);
    app = setup.app;
  });

  it("deletes message with valid auth", async () => {
    const res = await app.request("/api/status/message", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer test-admin-key-secret",
      },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(env.STATUS_KV.delete).toHaveBeenCalledWith("status:message");
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

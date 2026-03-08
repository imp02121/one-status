import { describe, it, expect, beforeEach, vi } from "vitest";
import { StatusPageClient } from "./client";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  StatusPageError,
} from "./errors";

const BASE_URL = "https://status-api.example.com";
const ADMIN_TOKEN = "test-admin-token";

function mockFetch(response: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}): void {
  const status = response.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () => Promise.resolve(response.body ?? {}),
      headers: new Headers(response.headers ?? {}),
    }),
  );
}

function getLastFetchCall(): { url: string; init: RequestInit } {
  const mock = vi.mocked(fetch);
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1]!;
  return { url: url as string, init: init as RequestInit };
}

describe("StatusPageClient", () => {
  let client: StatusPageClient;
  let adminClient: StatusPageClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new StatusPageClient({ baseUrl: BASE_URL });
    adminClient = new StatusPageClient({ baseUrl: BASE_URL, adminToken: ADMIN_TOKEN });
  });

  // ── Constructor ──

  describe("constructor", () => {
    it("strips trailing slashes from baseUrl", () => {
      mockFetch({ body: { status: "operational" } });
      const c = new StatusPageClient({ baseUrl: "https://api.example.com///" });
      c.getStatus();
      const { url } = getLastFetchCall();
      expect(url).toBe("https://api.example.com/status");
    });
  });

  // ── Public Endpoints ──

  describe("getStatus", () => {
    it("fetches current status", async () => {
      const statusData = {
        status: "operational",
        services: { api: { status: "operational", latencyMs: 42 } },
        updatedAt: "2026-01-01T00:00:00Z",
        message: null,
      };
      mockFetch({ body: statusData });

      const result = await client.getStatus();
      expect(result).toEqual(statusData);

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/status`);
      expect(init.method).toBe("GET");
    });
  });

  describe("getUptime", () => {
    it("fetches uptime entries for a service", async () => {
      const entries = [{ date: "2026-01-01", uptime: { uptimePercent: 99.9 } }];
      mockFetch({ body: { service: "api", days: 90, entries } });

      const result = await client.getUptime("api");
      expect(result).toEqual(entries);

      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/uptime?service=api`);
    });

    it("passes days parameter when provided", async () => {
      mockFetch({ body: { service: "api", days: 7, entries: [] } });

      await client.getUptime("api", 7);
      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/uptime?service=api&days=7`);
    });
  });

  describe("getIncidents", () => {
    it("fetches paginated incidents", async () => {
      const data = {
        incidents: [{ id: 1, title: "Outage" }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      mockFetch({ body: data });

      const result = await client.getIncidents();
      expect(result).toEqual(data);

      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/incidents`);
    });

    it("passes pagination parameters", async () => {
      mockFetch({ body: { incidents: [], pagination: {} } });

      await client.getIncidents({ page: 2, limit: 10 });
      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/incidents?page=2&limit=10`);
    });
  });

  describe("subscribe", () => {
    it("subscribes an email address", async () => {
      mockFetch({ body: { message: "Subscription received. Check your email to verify." } });

      const result = await client.subscribe("test@example.com");
      expect(result.message).toContain("Subscription received");

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/subscribe`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ email: "test@example.com" });
    });
  });

  // ── Admin: Incidents ──

  describe("createIncident", () => {
    it("creates an incident with admin auth", async () => {
      mockFetch({ status: 201, body: { id: 1, message: "Incident created" } });

      const result = await adminClient.createIncident({
        title: "API Outage",
        severity: "critical",
        description: "The API is down",
        affectedServices: ["api"],
      });
      expect(result.id).toBe(1);

      const { init } = getLastFetchCall();
      expect(init.headers).toHaveProperty("Authorization", `Bearer ${ADMIN_TOKEN}`);
    });

    it("throws AuthenticationError without admin token", async () => {
      await expect(
        client.createIncident({ title: "Test", severity: "minor" }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("updateIncident", () => {
    it("updates an incident", async () => {
      mockFetch({ body: { message: "Incident updated" } });

      const result = await adminClient.updateIncident(1, { status: "resolved" });
      expect(result.message).toBe("Incident updated");

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/incidents/1`);
      expect(init.method).toBe("PUT");
    });

    it("throws without admin token", async () => {
      await expect(
        client.updateIncident(1, { status: "resolved" }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("deleteIncident", () => {
    it("deletes an incident", async () => {
      mockFetch({ body: { message: "Incident deleted" } });

      const result = await adminClient.deleteIncident(1);
      expect(result.message).toBe("Incident deleted");

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/incidents/1`);
      expect(init.method).toBe("DELETE");
    });

    it("throws without admin token", async () => {
      await expect(client.deleteIncident(1)).rejects.toThrow(AuthenticationError);
    });
  });

  describe("getIncident", () => {
    it("fetches a single incident with updates", async () => {
      const data = {
        incident: { id: 1, title: "Outage" },
        updates: [{ id: 1, message: "Investigating" }],
      };
      mockFetch({ body: data });

      const result = await client.getIncident(1);
      expect(result).toEqual(data);

      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/incidents/1`);
    });

    it("works without admin token (public endpoint)", async () => {
      mockFetch({ body: { incident: {}, updates: [] } });
      await expect(client.getIncident(1)).resolves.toBeDefined();
    });
  });

  describe("addIncidentUpdate", () => {
    it("adds an update to an incident", async () => {
      mockFetch({ status: 201, body: { id: 5, message: "Update added" } });

      const result = await adminClient.addIncidentUpdate(1, {
        message: "Root cause identified",
        status: "identified",
      });
      expect(result.id).toBe(5);

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/incidents/1/updates`);
      expect(init.method).toBe("POST");
    });

    it("throws without admin token", async () => {
      await expect(
        client.addIncidentUpdate(1, { message: "test", status: "investigating" }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  // ── Admin: Subscribers ──

  describe("listSubscribers", () => {
    it("lists subscribers with pagination", async () => {
      const data = {
        subscribers: [{ id: 1, email: "a@b.com", verified: true }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      };
      mockFetch({ body: data });

      const result = await adminClient.listSubscribers();
      expect(result).toEqual(data);

      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/admin/subscribers`);
    });

    it("passes verified filter", async () => {
      mockFetch({ body: { subscribers: [], pagination: {} } });

      await adminClient.listSubscribers({ verified: true, page: 1 });
      const { url } = getLastFetchCall();
      expect(url).toContain("verified=true");
      expect(url).toContain("page=1");
    });

    it("throws without admin token", async () => {
      await expect(client.listSubscribers()).rejects.toThrow(AuthenticationError);
    });
  });

  describe("removeSubscriber", () => {
    it("removes a subscriber", async () => {
      mockFetch({ body: { message: "Subscriber removed" } });

      const result = await adminClient.removeSubscriber(1);
      expect(result.message).toBe("Subscriber removed");

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/admin/subscribers/1`);
      expect(init.method).toBe("DELETE");
    });

    it("throws without admin token", async () => {
      await expect(client.removeSubscriber(1)).rejects.toThrow(AuthenticationError);
    });
  });

  describe("getSubscriberCount", () => {
    it("gets subscriber counts", async () => {
      const data = { total: 100, verified: 80, unverified: 20 };
      mockFetch({ body: data });

      const result = await adminClient.getSubscriberCount();
      expect(result).toEqual(data);

      const { url } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/admin/subscribers/count`);
    });

    it("throws without admin token", async () => {
      await expect(client.getSubscriberCount()).rejects.toThrow(AuthenticationError);
    });
  });

  describe("notifySubscribers", () => {
    it("sends notifications to subscribers", async () => {
      mockFetch({ body: { message: "Notifications sent", sent: 50 } });

      const result = await adminClient.notifySubscribers({
        subject: "Update",
        html: "<p>All systems operational</p>",
      });
      expect(result.sent).toBe(50);

      const { url, init } = getLastFetchCall();
      expect(url).toBe(`${BASE_URL}/admin/subscribers/notify`);
      expect(init.method).toBe("POST");
    });

    it("throws without admin token", async () => {
      await expect(
        client.notifySubscribers({ subject: "test", html: "<p>test</p>" }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  // ── Admin: Config ──

  describe("getConfig", () => {
    it("fetches the status page config", async () => {
      const config = { services: [], emailFrom: "test@test.com" };
      mockFetch({ body: { config } });

      const result = await adminClient.getConfig();
      expect(result.config).toEqual(config);
    });

    it("throws without admin token", async () => {
      await expect(client.getConfig()).rejects.toThrow(AuthenticationError);
    });
  });

  describe("updateConfig", () => {
    it("updates the status page config", async () => {
      mockFetch({ body: { message: "Configuration updated" } });

      const config = {
        services: [{ slug: "api", name: "API", url: "https://api.example.com", checkType: "head" as const }],
        emailFrom: "status@example.com",
        emailFromName: "Status",
        notifications: {
          slack: { enabled: false, webhookUrl: "", severityFilter: [], escalation: [] },
          email: { enabled: true, onStatusChange: true, onIncident: true },
        },
      };

      const result = await adminClient.updateConfig(config);
      expect(result.message).toBe("Configuration updated");

      const { init } = getLastFetchCall();
      expect(init.method).toBe("PUT");
    });

    it("throws without admin token", async () => {
      const config = {} as never;
      await expect(client.updateConfig(config)).rejects.toThrow(AuthenticationError);
    });
  });

  // ── Error Handling ──

  describe("error handling", () => {
    it("throws AuthenticationError on 401", async () => {
      mockFetch({ status: 401, body: { error: "Unauthorized" } });

      await expect(adminClient.getStatus()).rejects.toThrow(AuthenticationError);
      await expect(adminClient.getStatus()).rejects.toMatchObject({
        status: 401,
        message: "Unauthorized",
      });
    });

    it("throws NotFoundError on 404", async () => {
      mockFetch({ status: 404, body: { error: "Incident not found" } });

      await expect(client.getIncident(999)).rejects.toThrow(NotFoundError);
      await expect(client.getIncident(999)).rejects.toMatchObject({
        status: 404,
        message: "Incident not found",
      });
    });

    it("throws ValidationError on 400", async () => {
      mockFetch({
        status: 400,
        body: { error: "Invalid parameters", details: { title: ["Required"] } },
      });

      try {
        await adminClient.createIncident({ title: "", severity: "minor" });
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        expect((e as ValidationError).details).toEqual({ title: ["Required"] });
      }
    });

    it("throws ValidationError on 422", async () => {
      mockFetch({ status: 422, body: { error: "Unprocessable entity" } });

      await expect(
        adminClient.createIncident({ title: "x", severity: "minor" }),
      ).rejects.toThrow(ValidationError);
    });

    it("throws RateLimitError on 429 with Retry-After header", async () => {
      mockFetch({
        status: 429,
        body: { error: "Rate limit exceeded" },
        headers: { "Retry-After": "60" },
      });

      try {
        await client.subscribe("test@example.com");
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfter).toBe(60);
      }
    });

    it("throws StatusPageError on unexpected status codes", async () => {
      mockFetch({ status: 500, body: { error: "Internal server error" } });

      await expect(client.getStatus()).rejects.toThrow(StatusPageError);
      await expect(client.getStatus()).rejects.toMatchObject({ status: 500 });
    });

    it("handles non-JSON error responses", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
          json: () => Promise.reject(new Error("not json")),
          headers: new Headers(),
        }),
      );

      await expect(client.getStatus()).rejects.toThrow(StatusPageError);
      await expect(client.getStatus()).rejects.toMatchObject({
        status: 502,
        message: "Bad Gateway",
      });
    });
  });

  // ── Timeout Handling ──

  describe("timeout", () => {
    it("throws on timeout", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init: RequestInit) => {
          return new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              const err = new DOMException("The operation was aborted.", "AbortError");
              reject(err);
            });
          });
        }),
      );

      const fastClient = new StatusPageClient({
        baseUrl: BASE_URL,
        timeout: 1,
      });

      await expect(fastClient.getStatus()).rejects.toThrow(StatusPageError);
      await expect(fastClient.getStatus()).rejects.toMatchObject({ code: "TIMEOUT" });
    });

    it("throws on network error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      await expect(client.getStatus()).rejects.toThrow(StatusPageError);
      await expect(client.getStatus()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    });
  });

  // ── Auth Header ──

  describe("auth headers", () => {
    it("includes Authorization header when adminToken is set", async () => {
      mockFetch({ body: {} });
      await adminClient.getStatus();
      const { init } = getLastFetchCall();
      expect((init.headers as Record<string, string>)["Authorization"]).toBe(
        `Bearer ${ADMIN_TOKEN}`,
      );
    });

    it("does not include Authorization header without adminToken", async () => {
      mockFetch({ body: {} });
      await client.getStatus();
      const { init } = getLastFetchCall();
      expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    });

    it("sets Content-Type for POST requests", async () => {
      mockFetch({ body: { message: "ok" } });
      await client.subscribe("test@example.com");
      const { init } = getLastFetchCall();
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });

    it("does not set Content-Type for GET requests", async () => {
      mockFetch({ body: {} });
      await client.getStatus();
      const { init } = getLastFetchCall();
      expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    });
  });
});

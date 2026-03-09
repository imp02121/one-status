import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleHealthCheck } from "./health-check";
import {
  createMockEnv,
  createMockD1WithTenants,
  createFetchResponse,
  createHeadResponse,
  mockApiHealthResponse,
  mockTenant,
  mockTenantService,
} from "../test-helpers";
import type { Env, LatestStatus, OverallStatus, DailyUptime, HistoryEntry, Tenant, TenantService } from "../types";
import { KV_KEYS, SERVICE_NAMES } from "../types";
import type { TenantOverallStatus } from "./kv-storage";

describe("handleHealthCheck", () => {
  let env: Env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));
    env = createMockEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mockAllHealthy() {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
      }
      return Promise.resolve(createHeadResponse(200));
    });
  }

  function mockOneDown(downUrl: string) {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        if (downUrl.includes("api.bundlenudge")) {
          return Promise.resolve(createHeadResponse(500));
        }
        return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
      }
      if (urlStr.includes(downUrl)) {
        return Promise.resolve(createHeadResponse(500));
      }
      return Promise.resolve(createHeadResponse(200));
    });
  }

  it("stores results for all 7 services in KV", async () => {
    mockAllHealthy();

    await handleHealthCheck(env);

    // Check that latest status was stored for each service
    for (const service of SERVICE_NAMES) {
      expect(env.STATUS_KV.put).toHaveBeenCalledWith(
        KV_KEYS.latest(service),
        expect.any(String),
      );
    }
  });

  it("sets overall status to 'operational' when all healthy", async () => {
    mockAllHealthy();

    await handleHealthCheck(env);

    const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.overall,
    );
    expect(overallCalls.length).toBeGreaterThan(0);
    const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
    expect(overall.status).toBe("operational");
  });

  it("sets overall status to 'down' when one service is down", async () => {
    mockOneDown("app.bundlenudge");

    await handleHealthCheck(env);

    const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.overall,
    );
    const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
    expect(overall.status).toBe("down");
  });

  it("sets overall status to 'degraded' when API reports degraded", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(
          createFetchResponse(mockApiHealthResponse({ status: "degraded" })),
        );
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.overall,
    );
    const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
    expect(overall.status).toBe("degraded");
  });

  it("parses API /health/deep response and extracts service status", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(
          createFetchResponse(mockApiHealthResponse({ status: "healthy" })),
        );
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    const apiLatestCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.latest("api"),
    );
    const latest: LatestStatus = JSON.parse(apiLatestCalls[0][1] as string);
    expect(latest.status).toBe("operational");
    expect(latest.service).toBe("api");
    expect(latest.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("marks service 'down' on HEAD request non-200 status", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
      }
      if (urlStr.includes("docs.bundlenudge")) {
        return Promise.resolve(createHeadResponse(503));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    const docsLatestCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.latest("documentation"),
    );
    const latest: LatestStatus = JSON.parse(docsLatestCalls[0][1] as string);
    expect(latest.status).toBe("down");
  });

  it("marks dashboard 'down' on HEAD request 403 status", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
      }
      if (urlStr.includes("app.bundlenudge")) {
        return Promise.resolve(createHeadResponse(403));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    const dashboardLatestCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.latest("dashboard"),
    );
    const latest: LatestStatus = JSON.parse(dashboardLatestCalls[0][1] as string);
    expect(latest.status).toBe("down");
  });

  it("marks service 'down' on network error without crashing", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await expect(handleHealthCheck(env)).resolves.not.toThrow();

    const apiLatestCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.latest("api"),
    );
    const latest: LatestStatus = JSON.parse(apiLatestCalls[0][1] as string);
    expect(latest.status).toBe("down");
  });

  it("marks API 'down' on timeout without crashing", async () => {
    // Simulate what fetchWithTimeout does when aborted: throws DOMException AbortError,
    // which gets caught and re-thrown as TimeoutError
    vi.useRealTimers();
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        // Simulate abort error immediately
        return Promise.reject(
          new DOMException("The operation was aborted.", "AbortError"),
        );
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    const apiLatestCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.latest("api"),
    );
    const latest: LatestStatus = JSON.parse(apiLatestCalls[0][1] as string);
    expect(latest.status).toBe("down");
  });

  it("stores daily history entries (appends, not replaces)", async () => {
    // Pre-populate history with one entry
    const existingHistory: HistoryEntry[] = [
      { status: "operational", latencyMs: 30, checkedAt: "2026-03-08T09:55:00.000Z" },
    ];
    const historyKey = KV_KEYS.history("api", "2026-03-08");
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === historyKey) return JSON.stringify(existingHistory);
      return null;
    });

    mockAllHealthy();
    await handleHealthCheck(env);

    const historyCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === historyKey,
    );
    if (historyCalls.length > 0) {
      const history: HistoryEntry[] = JSON.parse(historyCalls[0][1] as string);
      expect(history.length).toBeGreaterThan(1);
    }
  });

  it("updates daily uptime counters correctly", async () => {
    mockAllHealthy();
    await handleHealthCheck(env);

    const uptimeKey = KV_KEYS.dailyUptime("api", "2026-03-08");
    const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === uptimeKey,
    );
    expect(uptimeCalls.length).toBeGreaterThan(0);
    const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
    expect(uptime.totalChecks).toBe(1);
    expect(uptime.operationalChecks).toBe(1);
    expect(uptime.downChecks).toBe(0);
    expect(uptime.uptimePercent).toBe(100);
  });

  it("increments down counter when service is down", async () => {
    mockOneDown("docs.bundlenudge");
    await handleHealthCheck(env);

    const uptimeKey = KV_KEYS.dailyUptime("documentation", "2026-03-08");
    const uptimeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === uptimeKey,
    );
    expect(uptimeCalls.length).toBeGreaterThan(0);
    const uptime: DailyUptime = JSON.parse(uptimeCalls[0][1] as string);
    expect(uptime.downChecks).toBe(1);
    expect(uptime.operationalChecks).toBe(0);
  });

  it("stores overall status in KV with all service statuses", async () => {
    mockAllHealthy();
    await handleHealthCheck(env);

    const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.overall,
    );
    expect(overallCalls.length).toBe(1);
    const overall: OverallStatus = JSON.parse(overallCalls[0][1] as string);
    expect(overall.services).toBeDefined();
    expect(Object.keys(overall.services)).toHaveLength(7);
  });

  it("triggers Slack notification on status change", async () => {
    // Set previous status as operational for api
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === KV_KEYS.latest("api")) {
        return JSON.stringify({
          service: "api",
          status: "operational",
          latencyMs: 30,
          checkedAt: "2026-03-08T09:55:00.000Z",
        });
      }
      return null;
    });

    // Now API is down
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createHeadResponse(500));
      }
      if (urlStr.includes("hooks.slack.com")) {
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      if (urlStr.includes("api.resend.com")) {
        return Promise.resolve(createFetchResponse({ id: "email-1" }));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    // Slack webhook should have been called
    const slackCalls = vi.mocked(fetch).mock.calls.filter(
      (call) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString();
        return url.includes("hooks.slack.com");
      },
    );
    expect(slackCalls.length).toBeGreaterThan(0);
  });

  it("does not notify when status stays the same", async () => {
    // Set previous status as operational
    vi.mocked(env.STATUS_KV.get).mockImplementation(async (key: string) => {
      if (key === KV_KEYS.latest("api")) {
        return JSON.stringify({
          service: "api",
          status: "operational",
          latencyMs: 30,
          checkedAt: "2026-03-08T09:55:00.000Z",
        });
      }
      return null;
    });

    // API is still operational
    mockAllHealthy();
    await handleHealthCheck(env);

    // No Slack calls
    const slackCalls = vi.mocked(fetch).mock.calls.filter(
      (call) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString();
        return url.includes("hooks.slack.com");
      },
    );
    expect(slackCalls.length).toBe(0);
  });

  it("does not notify on first run (no previous status)", async () => {
    mockAllHealthy();
    await handleHealthCheck(env);

    const slackCalls = vi.mocked(fetch).mock.calls.filter(
      (call) => {
        const url = typeof call[0] === "string" ? call[0] : call[0].toString();
        return url.includes("hooks.slack.com");
      },
    );
    expect(slackCalls.length).toBe(0);
  });

  it("derives edge-delivery status from API status", async () => {
    mockAllHealthy();
    await handleHealthCheck(env);

    const edgeCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.latest("edge-delivery"),
    );
    expect(edgeCalls.length).toBeGreaterThan(0);
    const latest: LatestStatus = JSON.parse(edgeCalls[0][1] as string);
    expect(latest.status).toBe("operational");
  });

  it("marks derived services as down when API is down", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createHeadResponse(500));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    for (const service of ["authentication", "edge-delivery", "ota-updates", "build-service"] as const) {
      const calls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
        (call) => call[0] === KV_KEYS.latest(service),
      );
      const latest: LatestStatus = JSON.parse(calls[0][1] as string);
      expect(latest.status).toBe("down");
    }
  });

  it("runs cleanup at midnight UTC (hour=0, minute<6)", async () => {
    vi.setSystemTime(new Date("2026-03-08T00:03:00.000Z"));

    mockAllHealthy();
    // Add mock for D1 delete query
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    // Should have called KV.delete for old entries
    expect(env.STATUS_KV.delete).toHaveBeenCalled();
    // Should have called D1 delete for old resolved incidents
    expect(env.STATUS_DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM status_incidents"),
    );
  });

  it("does not run cleanup outside midnight window", async () => {
    vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));

    mockAllHealthy();
    await handleHealthCheck(env);

    // Should not have called delete for cleanup
    expect(env.STATUS_KV.delete).not.toHaveBeenCalled();
  });

  it("checks all 3 external URLs in parallel", async () => {
    mockAllHealthy();
    await handleHealthCheck(env);

    const fetchedUrls = vi.mocked(fetch).mock.calls.map((call) =>
      typeof call[0] === "string" ? call[0] : call[0].toString(),
    );

    expect(fetchedUrls).toContain("https://api.bundlenudge.com/health/deep");
    expect(fetchedUrls.some((u) => u.includes("app.bundlenudge.com"))).toBe(true);
    expect(fetchedUrls.some((u) => u.includes("docs.bundlenudge.com"))).toBe(true);
  });
});

describe("handleHealthCheck — multi-tenant", () => {
  let env: Env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setupEnv(
    tenants: Tenant[],
    servicesByTenantId: Record<string, TenantService[]>,
  ) {
    const db = createMockD1WithTenants(tenants, servicesByTenantId);
    env = createMockEnv({ STATUS_DB: db });
  }

  it("processes all tenants from D1", async () => {
    const tenant1 = mockTenant({ id: "t1", slug: "acme" });
    const tenant2 = mockTenant({ id: "t2", slug: "globex" });
    const svc1 = mockTenantService({ tenantId: "t1", slug: "web", url: "https://acme.com" });
    const svc2 = mockTenantService({ tenantId: "t2", slug: "api", url: "https://globex.com" });
    setupEnv([tenant1, tenant2], { t1: [svc1], t2: [svc2] });

    vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

    await handleHealthCheck(env);

    // Both tenants should have results stored
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantLatest("t1", "web"),
      expect.any(String),
    );
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantLatest("t2", "api"),
      expect.any(String),
    );
  });

  it("stores results in tenant-prefixed KV keys", async () => {
    const tenant = mockTenant({ id: "t1", slug: "acme" });
    const svc1 = mockTenantService({ tenantId: "t1", slug: "web", url: "https://acme.com" });
    const svc2 = mockTenantService({ tenantId: "t1", slug: "api", url: "https://api.acme.com" });
    setupEnv([tenant], { t1: [svc1, svc2] });

    vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

    await handleHealthCheck(env);

    // Latest
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantLatest("t1", "web"),
      expect.any(String),
    );
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantLatest("t1", "api"),
      expect.any(String),
    );

    // History
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantHistory("t1", "web", "2026-03-08"),
      expect.any(String),
    );

    // Daily uptime
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantDailyUptime("t1", "web", "2026-03-08"),
      expect.any(String),
    );

    // Overall
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.tenantOverall("t1"),
      expect.any(String),
    );
  });

  it("computes tenant overall status correctly", async () => {
    const tenant = mockTenant({ id: "t1", slug: "acme" });
    const svc1 = mockTenantService({ tenantId: "t1", slug: "web", url: "https://acme.com" });
    const svc2 = mockTenantService({ tenantId: "t1", slug: "api", url: "https://api.acme.com" });
    setupEnv([tenant], { t1: [svc1, svc2] });

    // web is up, api is down
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("api.acme")) {
        return Promise.resolve(createHeadResponse(500));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    const overallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.tenantOverall("t1"),
    );
    expect(overallCalls.length).toBe(1);
    const overall: TenantOverallStatus = JSON.parse(overallCalls[0][1] as string);
    expect(overall.status).toBe("down");
    expect(overall.services["web"]).toBe("operational");
    expect(overall.services["api"]).toBe("down");
  });

  it("handles no tenants gracefully — falls back to legacy", async () => {
    setupEnv([], {});

    // Legacy behavior: hits hardcoded BundleNudge URLs
    vi.mocked(fetch).mockImplementation((url) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/health/deep")) {
        return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
      }
      return Promise.resolve(createHeadResponse(200));
    });

    await handleHealthCheck(env);

    // Legacy overall should be stored (not tenant-prefixed)
    expect(env.STATUS_KV.put).toHaveBeenCalledWith(
      KV_KEYS.overall,
      expect.any(String),
    );

    // Should NOT have any tenant-prefixed keys
    const allPutCalls = vi.mocked(env.STATUS_KV.put).mock.calls;
    const tenantCalls = allPutCalls.filter(
      (call) => (call[0] as string).startsWith("tenant:"),
    );
    expect(tenantCalls).toHaveLength(0);
  });

  it("skips tenant with no enabled services", async () => {
    const tenant = mockTenant({ id: "t1", slug: "acme" });
    setupEnv([tenant], { t1: [] }); // No services

    await handleHealthCheck(env);

    // No tenant KV writes should occur
    const allPutCalls = vi.mocked(env.STATUS_KV.put).mock.calls;
    const tenantCalls = allPutCalls.filter(
      (call) => (call[0] as string).startsWith("tenant:"),
    );
    expect(tenantCalls).toHaveLength(0);
  });

  it("fetches correct URLs for tenant services", async () => {
    const tenant = mockTenant({ id: "t1", slug: "acme" });
    const svc = mockTenantService({
      tenantId: "t1",
      slug: "web",
      url: "https://acme.com",
      checkType: "head",
    });
    setupEnv([tenant], { t1: [svc] });

    vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

    await handleHealthCheck(env);

    const fetchedUrls = vi.mocked(fetch).mock.calls.map((call) =>
      typeof call[0] === "string" ? call[0] : call[0].toString(),
    );
    expect(fetchedUrls).toContain("https://acme.com");
  });

  it("does not write legacy overall key when tenants exist", async () => {
    const tenant = mockTenant({ id: "t1", slug: "acme" });
    const svc = mockTenantService({ tenantId: "t1", slug: "web", url: "https://acme.com" });
    setupEnv([tenant], { t1: [svc] });

    vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

    await handleHealthCheck(env);

    const legacyOverallCalls = vi.mocked(env.STATUS_KV.put).mock.calls.filter(
      (call) => call[0] === KV_KEYS.overall,
    );
    expect(legacyOverallCalls).toHaveLength(0);
  });
});

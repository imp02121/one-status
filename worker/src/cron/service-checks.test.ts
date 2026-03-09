import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAllChecks, runTenantServiceChecks } from "./service-checks";
import {
  createFetchResponse,
  createHeadResponse,
  mockApiHealthResponse,
  mockTenantService,
} from "../test-helpers";
import { TimeoutError } from "../lib/fetch-timeout";
import type { HealthCheckResult, ServiceName, TenantService } from "../types";

describe("service-checks", () => {
  const now = new Date("2026-03-08T12:00:00.000Z");
  const checkedAt = now.toISOString();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
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

  describe("runAllChecks", () => {
    it("returns results for all 7 services", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);

      expect(results).toHaveLength(7);
      const serviceNames = results.map((r) => r.service);
      expect(serviceNames).toContain("api");
      expect(serviceNames).toContain("dashboard");
      expect(serviceNames).toContain("documentation");
      expect(serviceNames).toContain("authentication");
      expect(serviceNames).toContain("edge-delivery");
      expect(serviceNames).toContain("ota-updates");
      expect(serviceNames).toContain("build-service");
    });

    it("sets checkedAt on all results", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);

      for (const result of results) {
        expect(result.checkedAt).toBe(checkedAt);
      }
    });

    it("includes latencyMs on all results", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);

      for (const result of results) {
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("checkApi (via runAllChecks)", () => {
    it("returns operational when API reports healthy", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);
      const api = results.find((r) => r.service === "api");

      expect(api).toBeDefined();
      expect(api!.status).toBe("operational");
      expect(api!.error).toBeUndefined();
    });

    it("returns degraded when API reports degraded", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.resolve(
            createFetchResponse(mockApiHealthResponse({ status: "degraded" })),
          );
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);
      const api = results.find((r) => r.service === "api");

      expect(api!.status).toBe("degraded");
    });

    it("returns down on non-200 HTTP status", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.resolve(createHeadResponse(500));
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);
      const api = results.find((r) => r.service === "api");

      expect(api!.status).toBe("down");
      expect(api!.error).toBe("HTTP 500");
    });

    it("returns down with timeout error string on fetch timeout", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.reject(new TimeoutError(urlStr, 5000));
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);
      const api = results.find((r) => r.service === "api");

      expect(api!.status).toBe("down");
      expect(api!.error).toBe("timeout");
    });

    it("returns down with error string on network failure", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);
      const api = results.find((r) => r.service === "api");

      expect(api!.status).toBe("down");
      expect(api!.error).toContain("Failed to fetch");
    });
  });

  describe("checkHead (via runAllChecks)", () => {
    it("returns operational for dashboard on 200", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);
      const dashboard = results.find((r) => r.service === "dashboard");

      expect(dashboard!.status).toBe("operational");
      expect(dashboard!.error).toBeUndefined();
    });

    it("returns down for dashboard on 503", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
        }
        if (urlStr.includes("app.bundlenudge")) {
          return Promise.resolve(createHeadResponse(503));
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);
      const dashboard = results.find((r) => r.service === "dashboard");

      expect(dashboard!.status).toBe("down");
      expect(dashboard!.error).toBe("HTTP 503");
    });

    it("returns down for documentation on timeout", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.resolve(createFetchResponse(mockApiHealthResponse()));
        }
        if (urlStr.includes("docs.bundlenudge")) {
          return Promise.reject(new TimeoutError(urlStr, 5000));
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);
      const docs = results.find((r) => r.service === "documentation");

      expect(docs!.status).toBe("down");
      expect(docs!.error).toBe("timeout");
    });
  });

  describe("deriveFromApi (via runAllChecks)", () => {
    const derivedServices: ServiceName[] = [
      "authentication",
      "edge-delivery",
      "ota-updates",
      "build-service",
    ];

    it("marks all derived services operational when API is operational", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);

      for (const service of derivedServices) {
        const result = results.find((r) => r.service === service);
        expect(result!.status).toBe("operational");
        expect(result!.error).toBeUndefined();
      }
    });

    it("marks all derived services degraded when API is degraded", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.resolve(
            createFetchResponse(mockApiHealthResponse({ status: "degraded" })),
          );
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);

      for (const service of derivedServices) {
        const result = results.find((r) => r.service === service);
        expect(result!.status).toBe("degraded");
      }
    });

    it("marks all derived services down when API is down", async () => {
      vi.mocked(fetch).mockImplementation((url) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/health/deep")) {
          return Promise.resolve(createHeadResponse(500));
        }
        return Promise.resolve(createHeadResponse(200));
      });

      const results = await runAllChecks(now);

      for (const service of derivedServices) {
        const result = results.find((r) => r.service === service);
        expect(result!.status).toBe("down");
        expect(result!.error).toBe("API unreachable");
      }
    });

    it("derived services share latencyMs with API result", async () => {
      mockAllHealthy();
      const results = await runAllChecks(now);
      const api = results.find((r) => r.service === "api");

      for (const service of derivedServices) {
        const result = results.find((r) => r.service === service);
        expect(result!.latencyMs).toBe(api!.latencyMs);
      }
    });
  });

  describe("runTenantServiceChecks", () => {
    it("returns results for all tenant services", async () => {
      vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

      const services: TenantService[] = [
        mockTenantService({ slug: "web-app", url: "https://app.example.com" }),
        mockTenantService({ slug: "api", url: "https://api.example.com" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results).toHaveLength(2);
      expect(results[0].slug).toBe("web-app");
      expect(results[1].slug).toBe("api");
    });

    it("sets status to operational on HEAD 200", async () => {
      vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

      const services = [
        mockTenantService({ slug: "site", url: "https://example.com", checkType: "head" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].status).toBe("operational");
      expect(results[0].error).toBeUndefined();
    });

    it("sets status to down on HEAD non-200", async () => {
      vi.mocked(fetch).mockResolvedValue(createHeadResponse(503));

      const services = [
        mockTenantService({ slug: "site", url: "https://example.com", checkType: "head" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].status).toBe("down");
      expect(results[0].error).toBe("HTTP 503");
    });

    it("sets status to operational on deep-health with healthy response", async () => {
      vi.mocked(fetch).mockResolvedValue(
        createFetchResponse(mockApiHealthResponse({ status: "healthy" })),
      );

      const services = [
        mockTenantService({ slug: "backend", url: "https://api.example.com/health", checkType: "deep-health" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].status).toBe("operational");
    });

    it("sets status to degraded on deep-health with degraded response", async () => {
      vi.mocked(fetch).mockResolvedValue(
        createFetchResponse(mockApiHealthResponse({ status: "degraded" })),
      );

      const services = [
        mockTenantService({ slug: "backend", url: "https://api.example.com/health", checkType: "deep-health" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].status).toBe("degraded");
    });

    it("sets status to down on network error", async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

      const services = [
        mockTenantService({ slug: "site", url: "https://example.com", checkType: "head" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].status).toBe("down");
      expect(results[0].error).toContain("Failed to fetch");
    });

    it("sets status to down with timeout error", async () => {
      vi.mocked(fetch).mockRejectedValue(
        new TimeoutError("https://example.com", 5000),
      );

      const services = [
        mockTenantService({ slug: "site", url: "https://example.com", checkType: "head" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].status).toBe("down");
      expect(results[0].error).toBe("timeout");
    });

    it("includes checkedAt on all results", async () => {
      vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

      const services = [
        mockTenantService({ slug: "a", url: "https://a.example.com" }),
        mockTenantService({ slug: "b", url: "https://b.example.com" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      for (const result of results) {
        expect(result.checkedAt).toBe(checkedAt);
      }
    });

    it("includes latencyMs on all results", async () => {
      vi.mocked(fetch).mockResolvedValue(createHeadResponse(200));

      const services = [
        mockTenantService({ slug: "a", url: "https://a.example.com" }),
      ];

      const results = await runTenantServiceChecks(services, now);

      expect(results[0].latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("handles empty services array", async () => {
      const results = await runTenantServiceChecks([], now);
      expect(results).toHaveLength(0);
    });
  });
});

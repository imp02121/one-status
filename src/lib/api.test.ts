import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock import.meta.env before importing the module
vi.stubGlobal("import", { meta: { env: { PUBLIC_STATUS_API_URL: "https://test-api.example.com" } } });

// We need to mock import.meta.env for the module under test.
// Vitest handles import.meta.env natively, so we set it before import.
const API_BASE = "https://test-api.example.com";

// Since the module reads import.meta.env at module level, we set it via vi.stubEnv
vi.stubEnv("PUBLIC_STATUS_API_URL", API_BASE);

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Dynamic import after env setup
let fetchStatus: typeof import("./api").fetchStatus;
let fetchUptime: typeof import("./api").fetchUptime;
let fetchIncidents: typeof import("./api").fetchIncidents;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", mockFetch);
  // Re-import to pick up fresh module state
  const mod = await import("./api");
  fetchStatus = mod.fetchStatus;
  fetchUptime = mod.fetchUptime;
  fetchIncidents = mod.fetchIncidents;
});

afterEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// fetchStatus
// ---------------------------------------------------------------------------
describe("fetchStatus", () => {
  it("returns transformed status for a successful response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "operational",
        services: { api: "operational", dashboard: "degraded" },
        updatedAt: "2026-03-01T12:00:00Z",
      })
    );

    const result = await fetchStatus();

    expect(result.overall).toBe("operational");
    expect(result.services).toHaveLength(2);
    expect(result.services[0]).toEqual(
      expect.objectContaining({ name: "API", slug: "api", status: "operational" })
    );
    expect(result.services[1]).toEqual(
      expect.objectContaining({ name: "Dashboard", slug: "dashboard", status: "degraded" })
    );
    expect(result.lastChecked).toBe(Math.floor(new Date("2026-03-01T12:00:00Z").getTime() / 1000));
  });

  it("maps 'down' overall status to 'outage'", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "down", services: {}, updatedAt: "2026-03-01T12:00:00Z" })
    );

    const result = await fetchStatus();
    expect(result.overall).toBe("outage");
  });

  it("maps 'degraded' overall status to 'degraded'", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "degraded", services: {}, updatedAt: "2026-03-01T12:00:00Z" })
    );

    const result = await fetchStatus();
    expect(result.overall).toBe("degraded");
  });

  it("maps unknown overall status strings to 'unknown'", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "banana", services: {}, updatedAt: "2026-03-01T12:00:00Z" })
    );

    const result = await fetchStatus();
    expect(result.overall).toBe("unknown");
  });

  it("maps 'unknown' overall status to 'unknown' (passthrough)", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "unknown", services: {}, updatedAt: "2026-03-01T12:00:00Z" })
    );

    const result = await fetchStatus();
    expect(result.overall).toBe("unknown");
  });

  it("uses display name from SERVICE_DISPLAY_NAMES for known slugs", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "operational",
        services: { "edge-delivery": "operational", "build-service": "operational" },
        updatedAt: "2026-03-01T12:00:00Z",
      })
    );

    const result = await fetchStatus();
    expect(result.services[0].name).toBe("Edge Delivery");
    expect(result.services[1].name).toBe("Build Service");
  });

  it("uses slug as-is for unknown service slugs", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "operational",
        services: { "custom-service": "operational" },
        updatedAt: "2026-03-01T12:00:00Z",
      })
    );

    const result = await fetchStatus();
    expect(result.services[0].name).toBe("custom-service");
    expect(result.services[0].slug).toBe("custom-service");
  });

  it("maps service status 'unknown' to 'degraded'", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "operational",
        services: { api: "unknown" },
        updatedAt: "2026-03-01T12:00:00Z",
      })
    );

    const result = await fetchStatus();
    expect(result.services[0].status).toBe("degraded");
  });

  it("returns empty services when services object is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "operational", updatedAt: "2026-03-01T12:00:00Z" })
    );

    const result = await fetchStatus();
    expect(result.services).toEqual([]);
  });

  it("returns lastChecked=0 when updatedAt is missing", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "operational", services: {} })
    );

    const result = await fetchStatus();
    expect(result.lastChecked).toBe(0);
  });

  it("includes message when present", async () => {
    const message = { text: "Scheduled maintenance", updatedAt: "2026-03-01T10:00:00Z" };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        status: "operational",
        services: {},
        updatedAt: "2026-03-01T12:00:00Z",
        message,
      })
    );

    const result = await fetchStatus();
    expect(result.message).toEqual(message);
  });

  it("returns safe defaults on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchStatus();
    expect(result).toEqual({ overall: "unknown", services: [], lastChecked: 0 });
  });

  it("returns safe defaults on HTTP error status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await fetchStatus();
    expect(result).toEqual({ overall: "unknown", services: [], lastChecked: 0 });
  });

  it("returns safe defaults on malformed JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } })
    );

    // The fetch succeeds (200) but res.json() will throw
    const result = await fetchStatus();
    expect(result).toEqual({ overall: "unknown", services: [], lastChecked: 0 });
  });

  it("handles timeout (AbortError)", async () => {
    mockFetch.mockImplementationOnce(() => {
      const error = new DOMException("The operation was aborted", "AbortError");
      return Promise.reject(error);
    });

    const result = await fetchStatus();
    expect(result).toEqual({ overall: "unknown", services: [], lastChecked: 0 });
  });

  it("passes abort signal to fetch", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ status: "operational", services: {}, updatedAt: "2026-03-01T12:00:00Z" })
    );

    await fetchStatus();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

// ---------------------------------------------------------------------------
// fetchUptime
// ---------------------------------------------------------------------------
describe("fetchUptime", () => {
  it("returns mapped uptime entries for successful response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          { date: "2026-03-01", uptime: { uptimePercent: 99.9 } },
          { date: "2026-03-02", uptime: { uptimePercent: 100 } },
        ],
      })
    );

    const result = await fetchUptime("api");
    expect(result).toEqual([
      { date: "2026-03-01", uptimePercent: 99.9 },
      { date: "2026-03-02", uptimePercent: 100 },
    ]);
  });

  it("returns -1 for entries with null uptime", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          { date: "2026-03-01", uptime: null },
          { date: "2026-03-02", uptime: { uptimePercent: 95.5 } },
        ],
      })
    );

    const result = await fetchUptime("api");
    expect(result[0].uptimePercent).toBe(-1);
    expect(result[1].uptimePercent).toBe(95.5);
  });

  it("encodes service name in URL", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }));

    await fetchUptime("edge-delivery", 30);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("service=edge-delivery");
    expect(calledUrl).toContain("days=30");
  });

  it("uses default 90 days when not specified", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ entries: [] }));

    await fetchUptime("api");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("days=90");
  });

  it("returns empty array on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchUptime("api");
    expect(result).toEqual([]);
  });

  it("returns empty array on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const result = await fetchUptime("api");
    expect(result).toEqual([]);
  });

  it("returns empty array on malformed JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("broken", { status: 200 })
    );

    const result = await fetchUptime("api");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchIncidents
// ---------------------------------------------------------------------------
describe("fetchIncidents", () => {
  const baseIncident = {
    id: 1,
    title: "API outage",
    description: "The API is experiencing issues",
    severity: "major",
    status: "investigating",
    affectedServices: '["api","dashboard"]',
    createdAt: "2026-03-01T12:00:00Z",
    resolvedAt: null,
  };

  it("returns transformed incidents for a successful response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [baseIncident],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      })
    );

    const result = await fetchIncidents();
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]).toEqual({
      id: "1",
      title: "API outage",
      description: "The API is experiencing issues",
      severity: "major",
      status: "investigating",
      affectedServices: ["api", "dashboard"],
      startTime: Math.floor(new Date("2026-03-01T12:00:00Z").getTime() / 1000),
      resolvedTime: undefined,
    });
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("converts resolvedAt to epoch seconds", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [{ ...baseIncident, resolvedAt: "2026-03-01T14:00:00Z" }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      })
    );

    const result = await fetchIncidents();
    expect(result.incidents[0].resolvedTime).toBe(
      Math.floor(new Date("2026-03-01T14:00:00Z").getTime() / 1000)
    );
  });

  it("handles malformed affectedServices JSON gracefully", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [{ ...baseIncident, affectedServices: "not-json" }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      })
    );

    const result = await fetchIncidents();
    expect(result.incidents[0].affectedServices).toEqual([]);
  });

  it("converts numeric id to string", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [{ ...baseIncident, id: 42 }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      })
    );

    const result = await fetchIncidents();
    expect(result.incidents[0].id).toBe("42");
  });

  it("passes pagination parameters in URL", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [],
        pagination: { page: 3, limit: 10, total: 0, totalPages: 0 },
      })
    );

    await fetchIncidents(3, 10);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=3");
    expect(calledUrl).toContain("limit=10");
  });

  it("uses default pagination (page=1, limit=20)", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      })
    );

    await fetchIncidents();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("limit=20");
  });

  it("returns safe defaults on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await fetchIncidents(2, 15);
    expect(result).toEqual({ incidents: [], total: 0, page: 2, pageSize: 15 });
  });

  it("returns safe defaults on HTTP error status", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Server Error", { status: 500 }));

    const result = await fetchIncidents();
    expect(result).toEqual({ incidents: [], total: 0, page: 1, pageSize: 20 });
  });

  it("returns safe defaults on malformed JSON", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("corrupt", { status: 200 })
    );

    const result = await fetchIncidents();
    expect(result).toEqual({ incidents: [], total: 0, page: 1, pageSize: 20 });
  });

  it("handles empty incidents array", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        incidents: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      })
    );

    const result = await fetchIncidents();
    expect(result.incidents).toEqual([]);
    expect(result.total).toBe(0);
  });
});

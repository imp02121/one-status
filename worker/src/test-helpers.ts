/**
 * Test mock factories for status page worker tests
 */
import { vi } from "vitest";
import type { Env, ServiceName, LatestStatus, OverallStatus, DailyUptime, ApiHealthResponse } from "./types";

// ----- KV Mock -----

export function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => {
      const keys = [...store.keys()].filter((k) =>
        k.startsWith(prefix ?? ""),
      );
      return {
        keys: keys.map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    }),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace;
}

// ----- D1 Mock -----

interface D1MockRow {
  [key: string]: unknown;
}

export function createMockD1(
  data: {
    queryResults?: Map<string, D1MockRow[]>;
    firstResults?: Map<string, D1MockRow | null>;
  } = {},
): D1Database {
  const queryResults = data.queryResults ?? new Map();
  const firstResults = data.firstResults ?? new Map();

  function createStatement(query: string) {
    let boundValues: unknown[] = [];

    const stmt = {
      bind: vi.fn((...values: unknown[]) => {
        boundValues = values;
        return stmt;
      }),
      all: vi.fn(async () => {
        const key = buildKey(query, boundValues);
        const results = queryResults.get(key) ?? queryResults.get(query) ?? [];
        return { results, success: true, meta: {} };
      }),
      first: vi.fn(async () => {
        const key = buildKey(query, boundValues);
        return firstResults.get(key) ?? firstResults.get(query) ?? null;
      }),
      run: vi.fn(async () => ({
        success: true,
        meta: { changes: 1 },
      })),
      raw: vi.fn(async () => []),
    };

    return stmt;
  }

  return {
    prepare: vi.fn((query: string) => createStatement(query)),
    batch: vi.fn(async () => []),
    exec: vi.fn(async () => ({ count: 0, duration: 0 })),
    dump: vi.fn(async () => new ArrayBuffer(0)),
  } as unknown as D1Database;
}

function buildKey(query: string, values: unknown[]): string {
  if (values.length === 0) return query;
  return `${query}::${values.map(String).join(",")}`;
}

// ----- Env Mock -----

export function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    STATUS_DB: createMockD1(),
    STATUS_KV: createMockKV(),
    SLACK_WEBHOOK_URL_OPS: "https://hooks.slack.com/services/test/webhook",
    RESEND_API_KEY: "test-resend-key",
    ENVIRONMENT: "test",
    STATUS_PAGE_URL: "https://status.bundlenudge.com",
    ADMIN_API_KEY: "test-admin-key-secret",
    ...overrides,
  };
}

// ----- Response Mock Factories -----

export function mockApiHealthResponse(
  overrides?: Partial<ApiHealthResponse>,
): ApiHealthResponse {
  return {
    status: "healthy",
    checks: {
      d1: { status: "ok", latencyMs: 5 },
      r2: { status: "ok", latencyMs: 12 },
      kv: { status: "ok", latencyMs: 3 },
      pgAuth: { status: "ok", latencyMs: 15 },
    },
    circuits: [],
    ...overrides,
  };
}

export function mockOverallStatus(
  overrides?: Partial<OverallStatus>,
): OverallStatus {
  return {
    status: "operational",
    services: {
      "api": "operational",
      "dashboard": "operational",
      "authentication": "operational",
      "edge-delivery": "operational",
      "ota-updates": "operational",
      "build-service": "operational",
      "documentation": "operational",
    },
    updatedAt: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

export function mockLatestStatus(
  service: ServiceName,
  overrides?: Partial<LatestStatus>,
): LatestStatus {
  return {
    service,
    status: "operational",
    latencyMs: 42,
    checkedAt: "2026-03-08T12:00:00.000Z",
    ...overrides,
  };
}

export function mockDailyUptime(
  overrides?: Partial<DailyUptime>,
): DailyUptime {
  return {
    totalChecks: 288,
    operationalChecks: 288,
    degradedChecks: 0,
    downChecks: 0,
    uptimePercent: 100,
    ...overrides,
  };
}

// ----- Fetch Mock Helpers -----

export function createFetchResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  const status = init?.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function createHeadResponse(status: number): Response {
  return new Response(null, { status });
}

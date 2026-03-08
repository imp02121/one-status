/**
 * Individual service health check probes
 */
import type {
  ServiceName,
  ServiceStatus,
  HealthCheckResult,
  ApiHealthResponse,
  StatusPageConfig,
} from "../types";
import { fetchWithTimeout, TimeoutError } from "../lib/fetch-timeout";

const CHECK_TIMEOUT_MS = 5_000;

export async function runAllChecks(now: Date): Promise<HealthCheckResult[]> {
  const checkedAt = now.toISOString();
  const checks = await Promise.all([
    checkApi(checkedAt),
    checkHead("dashboard", "https://app.bundlenudge.com", checkedAt),
    checkHead("documentation", "https://docs.bundlenudge.com", checkedAt),
  ]);

  const apiResult = checks[0];

  // Derived services from API deep health check
  const authResult = deriveFromApi(apiResult, "authentication", checkedAt);
  const edgeResult = deriveFromApi(apiResult, "edge-delivery", checkedAt);
  const otaResult = deriveFromApi(apiResult, "ota-updates", checkedAt);
  const buildResult = deriveFromApi(apiResult, "build-service", checkedAt);

  return [...checks, authResult, edgeResult, otaResult, buildResult];
}

async function checkApi(checkedAt: string): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      "https://api.bundlenudge.com/health/deep",
      { method: "GET", timeoutMs: CHECK_TIMEOUT_MS },
    );
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        service: "api",
        status: "down",
        latencyMs,
        checkedAt,
        error: `HTTP ${String(response.status)}`,
      };
    }

    const data = (await response.json()) as ApiHealthResponse;
    const status: ServiceStatus =
      data.status === "healthy" ? "operational" : "degraded";

    return { service: "api", status, latencyMs, checkedAt };
  } catch (err: unknown) {
    return {
      service: "api",
      status: "down",
      latencyMs: Date.now() - start,
      checkedAt,
      error: err instanceof TimeoutError ? "timeout" : String(err),
    };
  }
}

async function checkHead(
  service: ServiceName,
  url: string,
  checkedAt: string,
): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(url, {
      method: "HEAD",
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    const latencyMs = Date.now() - start;
    const status: ServiceStatus = response.ok ? "operational" : "down";

    return {
      service,
      status,
      latencyMs,
      checkedAt,
      error: response.ok ? undefined : `HTTP ${String(response.status)}`,
    };
  } catch (err: unknown) {
    return {
      service,
      status: "down",
      latencyMs: Date.now() - start,
      checkedAt,
      error: err instanceof TimeoutError ? "timeout" : String(err),
    };
  }
}

/** Run checks based on KV config services list */
export async function runConfiguredChecks(
  config: StatusPageConfig,
  now: Date,
): Promise<HealthCheckResult[]> {
  const checkedAt = now.toISOString();

  const checks = await Promise.all(
    config.services.map(async (svc) => {
      if (svc.checkType === "deep-health") {
        return checkDeepHealth(svc.slug as ServiceName, svc.url, checkedAt);
      }
      return checkHead(svc.slug as ServiceName, svc.url, checkedAt);
    }),
  );

  return checks;
}

async function checkDeepHealth(
  service: ServiceName,
  url: string,
  checkedAt: string,
): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      timeoutMs: CHECK_TIMEOUT_MS,
    });
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        service,
        status: "down",
        latencyMs,
        checkedAt,
        error: `HTTP ${String(response.status)}`,
      };
    }

    const data = (await response.json()) as ApiHealthResponse;
    const status: ServiceStatus =
      data.status === "healthy" ? "operational" : "degraded";

    return { service, status, latencyMs, checkedAt };
  } catch (err: unknown) {
    return {
      service,
      status: "down",
      latencyMs: Date.now() - start,
      checkedAt,
      error: err instanceof TimeoutError ? "timeout" : String(err),
    };
  }
}

function deriveFromApi(
  apiResult: HealthCheckResult,
  service: ServiceName,
  checkedAt: string,
): HealthCheckResult {
  if (apiResult.status === "down") {
    return {
      service,
      status: "down",
      latencyMs: apiResult.latencyMs,
      checkedAt,
      error: "API unreachable",
    };
  }

  return {
    service,
    status: apiResult.status,
    latencyMs: apiResult.latencyMs,
    checkedAt,
  };
}

/**
 * KV storage operations for health check results
 */
import type {
  Env,
  ServiceName,
  ServiceStatus,
  HealthCheckResult,
  LatestStatus,
  HistoryEntry,
  DailyUptime,
  OverallStatus,
} from "../types";
import { KV_KEYS } from "../types";

const MAX_HISTORY_ENTRIES = 288; // 24h * 12 checks/hour

export async function storeResults(
  env: Env,
  results: HealthCheckResult[],
  dateStr: string,
): Promise<void> {
  const overallStatuses: Record<string, ServiceStatus> = {};

  await Promise.all(
    results.map(async (result) => {
      overallStatuses[result.service] = result.status;

      const latest: LatestStatus = {
        service: result.service,
        status: result.status,
        latencyMs: result.latencyMs,
        checkedAt: result.checkedAt,
        error: result.error,
      };
      await env.STATUS_KV.put(
        KV_KEYS.latest(result.service),
        JSON.stringify(latest),
      );

      await appendHistory(env, result, dateStr);
      await updateDailyUptime(env, result, dateStr);
    }),
  );

  const overall = computeOverallStatus(
    overallStatuses as Record<ServiceName, ServiceStatus>,
  );
  await env.STATUS_KV.put(KV_KEYS.overall, JSON.stringify(overall));
}

async function appendHistory(
  env: Env,
  result: HealthCheckResult,
  dateStr: string,
): Promise<void> {
  const key = KV_KEYS.history(result.service, dateStr);
  const raw = await env.STATUS_KV.get(key);
  let history: HistoryEntry[] = [];
  if (raw) {
    try {
      history = JSON.parse(raw) as HistoryEntry[];
    } catch {
      history = [];
    }
  }

  history.push({
    status: result.status,
    latencyMs: result.latencyMs,
    checkedAt: result.checkedAt,
  });

  if (history.length > MAX_HISTORY_ENTRIES) {
    history.splice(0, history.length - MAX_HISTORY_ENTRIES);
  }

  await env.STATUS_KV.put(key, JSON.stringify(history));
}

async function updateDailyUptime(
  env: Env,
  result: HealthCheckResult,
  dateStr: string,
): Promise<void> {
  const key = KV_KEYS.dailyUptime(result.service, dateStr);
  const raw = await env.STATUS_KV.get(key);
  let uptime: DailyUptime = { totalChecks: 0, operationalChecks: 0, degradedChecks: 0, downChecks: 0, uptimePercent: 100 };
  if (raw) {
    try {
      uptime = JSON.parse(raw) as DailyUptime;
    } catch {
      // Reset on corrupt data
    }
  }

  uptime.totalChecks++;

  if (result.status === "operational") {
    uptime.operationalChecks++;
  } else if (result.status === "degraded") {
    uptime.degradedChecks++;
  } else {
    uptime.downChecks++;
  }

  uptime.uptimePercent =
    uptime.totalChecks > 0
      ? Math.round(
          ((uptime.operationalChecks + uptime.degradedChecks) /
            uptime.totalChecks) *
            10000,
        ) / 100
      : 100;

  await env.STATUS_KV.put(key, JSON.stringify(uptime));
}

function computeOverallStatus(
  statuses: Record<ServiceName, ServiceStatus>,
): OverallStatus {
  const values = Object.values(statuses);
  let overall: ServiceStatus = "operational";

  if (values.some((s) => s === "down")) {
    overall = "down";
  } else if (values.some((s) => s === "degraded")) {
    overall = "degraded";
  }

  return {
    status: overall,
    services: statuses,
    updatedAt: new Date().toISOString(),
  };
}

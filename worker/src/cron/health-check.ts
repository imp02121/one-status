/**
 * Cron health checker — runs every 5 minutes
 *
 * 1. Load config from KV (or use hardcoded defaults)
 * 2. Fetch previous statuses from KV
 * 3. Ping all services in parallel (5s timeout)
 * 4. Store results in KV (latest, daily history, daily uptime)
 * 5. Detect status changes
 * 6. Notify on changes (Slack + email, via config and hardcoded fallback)
 * 7. Check escalation triggers on open incidents
 * 8. Clean up entries older than 91 days
 */
import type {
  Env,
  ServiceStatus,
  HealthCheckResult,
  LatestStatus,
  StatusChange,
  StatusPageConfig,
} from "../types";
import { SERVICE_NAMES } from "../types";
import { runAllChecks, runConfiguredChecks } from "./service-checks";
import { storeResults } from "./kv-storage";
import { sendSlackNotification } from "../lib/slack";
import { sendStatusChangeEmails } from "../lib/email";
import {
  loadConfig,
  notifyStatusChangeViaConfig,
  checkEscalationTriggers,
} from "../lib/notifications";

const RETENTION_DAYS = 91;

export async function handleHealthCheck(env: Env): Promise<void> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  // 1. Load config from KV
  const config = await loadConfig(env);

  // 2. Read previous statuses
  const previousStatuses = await readPreviousStatuses(env, config);

  // 3. Run health checks
  const results = config
    ? await runConfiguredChecks(config, now)
    : await runAllChecks(now);

  // 4. Store results in KV
  await storeResults(env, results, dateStr);

  // 5. Detect changes
  const changes = detectChanges(previousStatuses, results, now);

  // 6. Notify on changes
  if (changes.length > 0) {
    await notifyChanges(env, changes, config);
  }

  // 7. Check escalation triggers
  try {
    await checkEscalationTriggers(env);
  } catch (err: unknown) {
    console.error("Escalation check failed:", err);
  }

  // 8. Cleanup old data (run once per day, at first check)
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  if (hour === 0 && minute < 6) {
    await cleanupOldEntries(env, now, config);
  }
}

async function readPreviousStatuses(
  env: Env,
  config: StatusPageConfig | null,
): Promise<Map<string, ServiceStatus>> {
  const map = new Map<string, ServiceStatus>();

  // Use config services if available, otherwise hardcoded SERVICE_NAMES
  const serviceKeys: string[] = config
    ? config.services.map((s) => s.slug)
    : [...SERVICE_NAMES];

  const reads = serviceKeys.map(async (name) => {
    const raw = await env.STATUS_KV.get(`health:${name}:latest`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as LatestStatus;
        map.set(name, parsed.status);
      } catch {
        map.set(name, "unknown");
      }
    }
  });
  await Promise.all(reads);
  return map;
}

function detectChanges(
  previousStatuses: Map<string, ServiceStatus>,
  results: HealthCheckResult[],
  now: Date,
): StatusChange[] {
  const changes: StatusChange[] = [];

  for (const result of results) {
    const previous = previousStatuses.get(result.service);
    if (!previous || previous === result.status) continue;

    changes.push({
      service: result.service,
      previousStatus: previous,
      newStatus: result.status,
      changedAt: now.toISOString(),
      error: result.error,
    });
  }

  return changes;
}

async function notifyChanges(
  env: Env,
  changes: StatusChange[],
  config: StatusPageConfig | null,
): Promise<void> {
  const pageUrl = env.STATUS_PAGE_URL;

  // Config-based notifications
  if (config) {
    try {
      await notifyStatusChangeViaConfig(env, { changes, pageUrl });
    } catch (err: unknown) {
      console.error("Config-based status change notification failed:", err);
    }
  }

  // Hardcoded fallback: Slack webhook
  try {
    await sendSlackNotification(env.SLACK_WEBHOOK_URL_OPS, changes, pageUrl);
  } catch (err: unknown) {
    console.error("Slack notification failed:", err);
  }

  // Hardcoded fallback: email subscribers (only if config doesn't handle it)
  if (!config || !config.notifications.email.enabled || !config.notifications.email.onStatusChange) {
    try {
      const subscribersResult = await env.STATUS_DB.prepare(
        "SELECT email, unsubscribe_token as unsubscribeToken FROM status_subscribers WHERE verified = 1",
      ).all<{ email: string; unsubscribeToken: string }>();

      if (subscribersResult.results.length > 0) {
        await sendStatusChangeEmails(
          env.RESEND_API_KEY,
          subscribersResult.results,
          changes,
          pageUrl,
        );
      }
    } catch (err: unknown) {
      console.error("Email notification failed:", err);
    }
  }
}

async function cleanupOldEntries(
  env: Env,
  now: Date,
  config: StatusPageConfig | null,
): Promise<void> {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

  const serviceKeys: string[] = config
    ? config.services.map((s) => s.slug)
    : [...SERVICE_NAMES];

  for (let dayOffset = RETENTION_DAYS; dayOffset < RETENTION_DAYS + 7; dayOffset++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - dayOffset);
    const dateStr = d.toISOString().split("T")[0];

    const deletes = serviceKeys.map(async (service) => {
      await env.STATUS_KV.delete(`health:${service}:history:${dateStr}`);
      await env.STATUS_KV.delete(`uptime:${service}:daily:${dateStr}`);
    });

    await Promise.all(deletes);
  }

  const cutoffStr = cutoff.toISOString();
  await env.STATUS_DB.prepare(
    "DELETE FROM status_incidents WHERE status = 'resolved' AND resolved_at < ?",
  )
    .bind(cutoffStr)
    .run();
}

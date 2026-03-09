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
 *
 * Multi-tenant: queries tenants table and runs per-tenant checks,
 * falling back to legacy hardcoded behavior when no tenants exist.
 */
import type {
  Env,
  ServiceStatus,
  HealthCheckResult,
  LatestStatus,
  StatusChange,
  StatusPageConfig,
  Tenant,
  TenantService,
} from "../types";
import { SERVICE_NAMES, KV_KEYS } from "../types";
import { TABLES } from "../schema";
import {
  runAllChecks,
  runConfiguredChecks,
  runTenantServiceChecks,
} from "./service-checks";
import type { TenantCheckResult } from "./service-checks";
import {
  storeResults,
  storeTenantHealthResult,
  storeTenantOverallStatus,
} from "./kv-storage";
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

  // 1. Query all tenants from D1
  const tenants = await loadTenants(env);

  if (tenants.length > 0) {
    // Multi-tenant path: run checks for each tenant sequentially
    for (const tenant of tenants) {
      await handleTenantHealthCheck(env, tenant, now, dateStr);
    }
  } else {
    // Legacy fallback: no tenants exist yet, use hardcoded SERVICE_NAMES
    await handleLegacyHealthCheck(env, now, dateStr);
  }

  // Check escalation triggers (global)
  try {
    await checkEscalationTriggers(env);
  } catch (err: unknown) {
    console.error("Escalation check failed:", err);
  }

  // Cleanup old data (run once per day, at first check)
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  if (hour === 0 && minute < 6) {
    if (tenants.length > 0) {
      await cleanupTenantEntries(env, now, tenants);
    } else {
      const config = await loadConfig(env);
      await cleanupOldEntries(env, now, config);
    }
  }
}

/** Load all tenants from D1 */
async function loadTenants(env: Env): Promise<Tenant[]> {
  try {
    const result = await env.STATUS_DB.prepare(
      `SELECT id, name, slug, plan, owner_id, custom_domain, custom_domain_status,
              branding_logo_url, branding_color, branding_show_badge, created_at
       FROM ${TABLES.tenants}`,
    ).all();

    return result.results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      plan: row.plan as Tenant["plan"],
      ownerId: row.owner_id as string,
      customDomain: (row.custom_domain as string) ?? null,
      customDomainStatus: (row.custom_domain_status as Tenant["customDomainStatus"]) ?? "none",
      brandingLogoUrl: (row.branding_logo_url as string) ?? null,
      brandingColor: (row.branding_color as string) ?? "#3B82F6",
      brandingShowBadge: Boolean(row.branding_show_badge),
      createdAt: row.created_at as string,
    }));
  } catch (err: unknown) {
    console.error("Failed to load tenants:", err);
    return [];
  }
}

/** Load enabled services for a specific tenant */
async function loadTenantServices(
  env: Env,
  tenantId: string,
): Promise<TenantService[]> {
  const result = await env.STATUS_DB.prepare(
    `SELECT id, tenant_id, slug, name, url, check_type, enabled
     FROM ${TABLES.tenantServices}
     WHERE tenant_id = ? AND enabled = 1`,
  )
    .bind(tenantId)
    .all();

  return result.results.map((row) => ({
    id: row.id as number,
    tenantId: row.tenant_id as string,
    slug: row.slug as string,
    name: row.name as string,
    url: row.url as string,
    checkType: row.check_type as TenantService["checkType"],
    enabled: Boolean(row.enabled),
  }));
}

/** Run health checks for a single tenant */
async function handleTenantHealthCheck(
  env: Env,
  tenant: Tenant,
  now: Date,
  dateStr: string,
): Promise<void> {
  // Load tenant's enabled services
  const services = await loadTenantServices(env, tenant.id);
  if (services.length === 0) return;

  // Read previous statuses for this tenant
  const previousStatuses = await readTenantPreviousStatuses(env, tenant.id, services);

  // Run checks
  const results = await runTenantServiceChecks(services, now);

  // Store results in tenant-prefixed KV keys
  for (const result of results) {
    await storeTenantHealthResult(env, tenant.id, result, dateStr);
  }

  // Store tenant overall status
  await storeTenantOverallStatus(env, tenant.id, results);

  // Detect status changes for this tenant
  const changes = detectTenantChanges(previousStatuses, results, now);

  if (changes.length > 0) {
    // For now, log tenant status changes. Tenant-specific notifications
    // will be added when notification config is per-tenant.
    console.log(
      `Tenant ${tenant.slug}: ${String(changes.length)} status change(s) detected`,
    );
  }
}

/** Read previous statuses for a tenant's services from KV */
async function readTenantPreviousStatuses(
  env: Env,
  tenantId: string,
  services: TenantService[],
): Promise<Map<string, ServiceStatus>> {
  const map = new Map<string, ServiceStatus>();

  const reads = services.map(async (svc) => {
    const raw = await env.STATUS_KV.get(
      KV_KEYS.tenantLatest(tenantId, svc.slug),
    );
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { status: ServiceStatus };
        map.set(svc.slug, parsed.status);
      } catch {
        map.set(svc.slug, "unknown");
      }
    }
  });
  await Promise.all(reads);
  return map;
}

/** Detect status changes for tenant services */
function detectTenantChanges(
  previousStatuses: Map<string, ServiceStatus>,
  results: TenantCheckResult[],
  now: Date,
): Array<{ slug: string; previousStatus: ServiceStatus; newStatus: ServiceStatus; changedAt: string }> {
  const changes: Array<{
    slug: string;
    previousStatus: ServiceStatus;
    newStatus: ServiceStatus;
    changedAt: string;
  }> = [];

  for (const result of results) {
    const previous = previousStatuses.get(result.slug);
    if (!previous || previous === result.status) continue;

    changes.push({
      slug: result.slug,
      previousStatus: previous,
      newStatus: result.status,
      changedAt: now.toISOString(),
    });
  }

  return changes;
}

/** Legacy (non-tenant) health check flow */
async function handleLegacyHealthCheck(
  env: Env,
  now: Date,
  dateStr: string,
): Promise<void> {
  const config = await loadConfig(env);

  const previousStatuses = await readPreviousStatuses(env, config);

  const results = config
    ? await runConfiguredChecks(config, now)
    : await runAllChecks(now);

  await storeResults(env, results, dateStr);

  const changes = detectChanges(previousStatuses, results, now);

  if (changes.length > 0) {
    await notifyChanges(env, changes, config);
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

async function cleanupTenantEntries(
  env: Env,
  now: Date,
  tenants: Tenant[],
): Promise<void> {
  for (const tenant of tenants) {
    const services = await loadTenantServices(env, tenant.id);

    for (let dayOffset = RETENTION_DAYS; dayOffset < RETENTION_DAYS + 7; dayOffset++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - dayOffset);
      const dateStr = d.toISOString().split("T")[0];

      const deletes = services.map(async (svc) => {
        await env.STATUS_KV.delete(
          KV_KEYS.tenantHistory(tenant.id, svc.slug, dateStr),
        );
        await env.STATUS_KV.delete(
          KV_KEYS.tenantDailyUptime(tenant.id, svc.slug, dateStr),
        );
      });
      await Promise.all(deletes);
    }
  }

  // Cleanup old resolved incidents (global, tenant_id column filters already)
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  await env.STATUS_DB.prepare(
    "DELETE FROM status_incidents WHERE status = 'resolved' AND resolved_at < ?",
  )
    .bind(cutoff.toISOString())
    .run();
}

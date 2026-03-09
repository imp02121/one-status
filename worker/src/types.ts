/**
 * Cloudflare Workers environment bindings for the status page worker
 */
export interface Env {
  STATUS_DB: D1Database;
  STATUS_KV: KVNamespace;
  SLACK_WEBHOOK_URL_OPS: string;
  RESEND_API_KEY: string;
  ENVIRONMENT: string;
  STATUS_PAGE_URL: string;
  ADMIN_API_KEY: string;
  ADMIN_TOKEN_EXPIRES_AT?: string;
}

/** Services monitored by the status page */
export type ServiceName =
  | "api"
  | "dashboard"
  | "authentication"
  | "edge-delivery"
  | "ota-updates"
  | "build-service"
  | "documentation";

export const SERVICE_NAMES: readonly ServiceName[] = [
  "api",
  "dashboard",
  "authentication",
  "edge-delivery",
  "ota-updates",
  "build-service",
  "documentation",
] as const;

export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  "api": "API",
  "dashboard": "Dashboard",
  "authentication": "Authentication",
  "edge-delivery": "Edge Delivery",
  "ota-updates": "OTA Updates",
  "build-service": "Build Service",
  "documentation": "Documentation",
};

/** Status of an individual service */
export type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

/** Result from a single health check probe */
export interface HealthCheckResult {
  service: ServiceName;
  status: ServiceStatus;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

/** KV entry for latest service status */
export interface LatestStatus {
  service: ServiceName;
  status: ServiceStatus;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

/** KV entry for daily history — array of check results */
export interface HistoryEntry {
  status: ServiceStatus;
  latencyMs: number;
  checkedAt: string;
}

/** KV entry for daily uptime running totals */
export interface DailyUptime {
  totalChecks: number;
  operationalChecks: number;
  degradedChecks: number;
  downChecks: number;
  uptimePercent: number;
}

/** Overall system status */
export interface OverallStatus {
  status: ServiceStatus;
  services: Record<ServiceName, ServiceStatus>;
  updatedAt: string;
}

/** Status change event for notifications */
export interface StatusChange {
  service: ServiceName;
  previousStatus: ServiceStatus;
  newStatus: ServiceStatus;
  changedAt: string;
  error?: string;
}

/** API deep health check response from the main API */
export interface ApiHealthResponse {
  status: "healthy" | "degraded";
  checks: {
    d1: { status: "ok" | "error"; latencyMs: number; error?: string };
    r2: { status: "ok" | "error"; latencyMs: number; error?: string };
    kv: { status: "ok" | "error"; latencyMs: number; error?: string };
    pgAuth: { status: "ok" | "error"; latencyMs: number; error?: string };
  };
  circuits: Array<{ name: string; state: string }>;
}

/** Incident severity levels */
export type IncidentSeverity = "critical" | "major" | "minor" | "maintenance";

/** Incident status values */
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

/** D1 incident record */
export interface Incident {
  id: number;
  title: string;
  description: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  affectedServices: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** D1 incident update record */
export interface IncidentUpdate {
  id: number;
  incidentId: number;
  message: string;
  status: IncidentStatus;
  tenantId: string;
  createdAt: string;
}

/** D1 subscriber record */
export interface Subscriber {
  id: number;
  email: string;
  verified: boolean;
  verifyToken: string;
  unsubscribeToken: string;
  tenantId: string;
  createdAt: string;
}

/** Slack escalation config */
export interface EscalationRule {
  afterMinutes: number;
  webhookUrl: string;
  mention?: string;
}

/** Status page configuration (stored in KV) */
export interface StatusPageConfig {
  services: Array<{
    slug: string;
    name: string;
    url: string;
    checkType: "head" | "deep-health";
  }>;
  emailFrom: string;
  emailFromName: string;
  notifications: {
    slack: {
      enabled: boolean;
      webhookUrl: string;
      channel?: string;
      severityFilter: IncidentSeverity[];
      escalation: EscalationRule[];
    };
    email: {
      enabled: boolean;
      onStatusChange: boolean;
      onIncident: boolean;
    };
  };
}

// ---------------------------------------------------------------------------
// Multi-tenancy types
// ---------------------------------------------------------------------------

/** Tenant plan tiers */
export type TenantPlan = "free" | "starter" | "pro" | "business";

/** Custom domain verification status */
export type CustomDomainStatus = "none" | "pending" | "active" | "failed";

/** D1 tenant record */
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  ownerId: string;
  customDomain: string | null;
  customDomainStatus: CustomDomainStatus;
  brandingLogoUrl: string | null;
  brandingColor: string;
  brandingShowBadge: boolean;
  createdAt: string;
}

/** D1 tenant service record */
export interface TenantService {
  id: number;
  tenantId: string;
  slug: string;
  name: string;
  url: string;
  checkType: "head" | "deep-health";
  enabled: boolean;
}

/** Tenant member roles */
export type TenantMemberRole = "owner" | "admin" | "editor" | "viewer";

/** D1 tenant member record */
export interface TenantMember {
  tenantId: string;
  userId: string;
  role: TenantMemberRole;
  invitedBy: string | null;
  joinedAt: string;
}

/** D1 tenant invitation record */
export interface TenantInvitation {
  id: string;
  tenantId: string;
  email: string;
  role: TenantMemberRole;
  token: string;
  invitedBy: string;
  expiresAt: string;
  createdAt: string;
}

/** D1 API key record */
export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** KV key patterns (global — for the default BundleNudge status page) */
export const KV_KEYS = {
  latest: (service: ServiceName) => `health:${service}:latest`,
  history: (service: ServiceName, date: string) =>
    `health:${service}:history:${date}`,
  dailyUptime: (service: ServiceName, date: string) =>
    `uptime:${service}:daily:${date}`,
  overall: "status:overall",
  config: "config:status-page",

  // Tenant-scoped keys
  tenantLatest: (tenantId: string, serviceSlug: string) =>
    `tenant:${tenantId}:health:${serviceSlug}:latest`,
  tenantHistory: (tenantId: string, serviceSlug: string, date: string) =>
    `tenant:${tenantId}:health:${serviceSlug}:history:${date}`,
  tenantDailyUptime: (tenantId: string, serviceSlug: string, date: string) =>
    `tenant:${tenantId}:uptime:${serviceSlug}:daily:${date}`,
  tenantOverall: (tenantId: string) =>
    `tenant:${tenantId}:status:overall`,
  tenantConfig: (tenantId: string) =>
    `tenant:${tenantId}:config`,
  tenantMessage: (tenantId: string) =>
    `tenant:${tenantId}:message`,
  tenantLookupBySlug: (slug: string) =>
    `lookup:slug:${slug}`,
  tenantLookupByDomain: (domain: string) =>
    `lookup:domain:${domain}`,
} as const;

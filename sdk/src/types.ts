// ── Service & Status Types ──

export type ServiceStatus = "operational" | "degraded" | "down" | "unknown";
export type IncidentSeverity = "critical" | "major" | "minor" | "maintenance";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";

// ── Status Response ──

export interface StatusResponse {
  status: ServiceStatus;
  services: Record<string, ServiceStatusEntry | null>;
  updatedAt: string;
  message: StatusMessage | null;
}

export interface ServiceStatusEntry {
  service: string;
  status: ServiceStatus;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface StatusMessage {
  text: string;
  updatedAt: string;
}

// ── Uptime ──

export interface UptimeEntry {
  date: string;
  uptime: DailyUptime | null;
}

export interface DailyUptime {
  totalChecks: number;
  operationalChecks: number;
  degradedChecks: number;
  downChecks: number;
  uptimePercent: number;
}

export interface UptimeResponse {
  service: string;
  days: number;
  entries: UptimeEntry[];
}

// ── Incidents ──

export interface Incident {
  id: number;
  title: string;
  description: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  affectedServices: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface IncidentUpdate {
  id: number;
  incidentId: number;
  message: string;
  status: IncidentStatus;
  createdAt: string;
}

export interface IncidentWithUpdates {
  incident: Incident;
  updates: IncidentUpdate[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface IncidentsResponse {
  incidents: Incident[];
  pagination: Pagination;
}

export interface CreateIncidentInput {
  title: string;
  description?: string;
  severity: IncidentSeverity;
  status?: IncidentStatus;
  affectedServices?: string[];
}

export interface UpdateIncidentInput {
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  affectedServices?: string[];
}

export interface AddIncidentUpdateInput {
  message: string;
  status: IncidentStatus;
}

// ── Subscribers ──

export interface Subscriber {
  id: number;
  email: string;
  verified: boolean;
  createdAt: string;
}

export interface SubscribersResponse {
  subscribers: Subscriber[];
  pagination: Pagination;
}

export interface SubscriberCount {
  total: number;
  verified: number;
  unverified: number;
}

export interface NotifyResult {
  message: string;
  sent: number;
}

// ── Config ──

export interface EscalationRule {
  afterMinutes: number;
  webhookUrl: string;
  mention?: string;
}

export interface ServiceConfig {
  slug: string;
  name: string;
  url: string;
  checkType: "head" | "deep-health";
}

export interface StatusPageConfig {
  services: ServiceConfig[];
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

// ── Client Options ──

export interface StatusPageClientOptions {
  baseUrl: string;
  adminToken?: string;
  timeout?: number;
}

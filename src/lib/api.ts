import { SERVICE_DISPLAY_NAMES } from '../../shared/constants';

const API_BASE = import.meta.env.PUBLIC_STATUS_API_URL || 'https://status-api.bundlenudge.com';

interface UptimeDay {
  date: string;
  uptimePercent: number;
}

interface ServiceStatus {
  name: string;
  slug: string;
  status: 'operational' | 'degraded' | 'down';
  latencyMs: number;
  uptimeDays: UptimeDay[];
  uptimePercent: number;
}

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: 'minor' | 'major' | 'critical' | 'maintenance';
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved';
  affectedServices: string[];
  startTime: number;
  resolvedTime?: number;
}

interface IncidentUpdate {
  id: number;
  incidentId: number;
  message: string;
  status: string;
  createdAt: string;
}

interface IncidentDetail {
  incident: Incident;
  updates: IncidentUpdate[];
}

interface StatusMessage {
  text: string;
  updatedAt: string;
}

interface StatusResponse {
  overall: 'operational' | 'degraded' | 'outage' | 'unknown';
  services: ServiceStatus[];
  lastChecked: number;
  message?: StatusMessage | null;
}

interface IncidentsResponse {
  incidents: Incident[];
  total: number;
  page: number;
  pageSize: number;
}

export type { UptimeDay, ServiceStatus, Incident, IncidentUpdate, IncidentDetail, StatusResponse, StatusMessage, IncidentsResponse };

async function fetchWithTimeout(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapOverallStatus(status: string): StatusResponse['overall'] {
  if (status === 'down') return 'outage';
  if (status === 'operational' || status === 'degraded' || status === 'unknown') return status;
  return 'unknown';
}

/**
 * Fetch current status from the worker.
 * Worker returns: { status, services: Record<name, statusString>, updatedAt, message? }
 * We transform to: { overall, services: ServiceStatus[], lastChecked (epoch), message? }
 */
export async function fetchStatus(): Promise<StatusResponse> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/status`);
    const data = await res.json() as {
      status: string;
      services: Record<string, string>;
      updatedAt: string;
      message?: StatusMessage | null;
    };

    const services: ServiceStatus[] = Object.entries(data.services || {}).map(([slug, svcStatus]) => ({
      name: SERVICE_DISPLAY_NAMES[slug] || slug,
      slug,
      status: (svcStatus === 'unknown' ? 'degraded' : svcStatus) as ServiceStatus['status'],
      latencyMs: 0,
      uptimeDays: [],
      uptimePercent: 100,
    }));

    return {
      overall: mapOverallStatus(data.status),
      services,
      lastChecked: data.updatedAt ? Math.floor(new Date(data.updatedAt).getTime() / 1000) : 0,
      message: data.message,
    };
  } catch (err) {
    console.error('Failed to fetch status:', err);
    return { overall: 'unknown', services: [], lastChecked: 0 };
  }
}

/**
 * Fetch uptime history for a service.
 * Worker returns: { service, days, entries: [{ date, uptime: DailyUptime | null }] }
 * We transform entries to UptimeDay[] (uptimePercent or -1 for missing).
 */
export async function fetchUptime(service: string, days = 90): Promise<UptimeDay[]> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/uptime?service=${encodeURIComponent(service)}&days=${days}`
    );
    const data = await res.json() as {
      entries: Array<{ date: string; uptime: { uptimePercent: number } | null }>;
    };
    return data.entries.map((e) => ({
      date: e.date,
      uptimePercent: e.uptime?.uptimePercent ?? -1,
    }));
  } catch (err) {
    console.error(`Failed to fetch uptime for ${service}:`, err);
    return [];
  }
}

/**
 * Fetch a single incident with its update timeline.
 * Worker returns: { incident: DBIncident, updates: DBIncidentUpdate[] }
 */
export async function fetchIncident(id: string): Promise<IncidentDetail | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/incidents/${encodeURIComponent(id)}`);
    const data = await res.json() as {
      incident: {
        id: number;
        title: string;
        description: string;
        severity: string;
        status: string;
        affected_services: string;
        created_at: string;
        updated_at: string;
        resolved_at: string | null;
      };
      updates: Array<{
        id: number;
        incident_id: number;
        message: string;
        status: string;
        created_at: string;
      }>;
    };

    let services: string[] = [];
    try { services = JSON.parse(data.incident.affected_services); } catch { /* non-JSON fallback */ }

    const incident: Incident = {
      id: String(data.incident.id),
      title: data.incident.title,
      description: data.incident.description,
      severity: data.incident.severity as Incident['severity'],
      status: data.incident.status as Incident['status'],
      affectedServices: services,
      startTime: Math.floor(new Date(data.incident.created_at).getTime() / 1000),
      resolvedTime: data.incident.resolved_at
        ? Math.floor(new Date(data.incident.resolved_at).getTime() / 1000)
        : undefined,
    };

    const updates: IncidentUpdate[] = data.updates.map((u) => ({
      id: u.id,
      incidentId: u.incident_id,
      message: u.message,
      status: u.status,
      createdAt: u.created_at,
    }));

    return { incident, updates };
  } catch (err) {
    console.error(`Failed to fetch incident ${id}:`, err);
    return null;
  }
}

/**
 * Fetch incidents from D1.
 * Worker returns: { incidents: DBIncident[], pagination: { page, limit, total, totalPages } }
 * We transform DB rows (createdAt ISO, affectedServices JSON string) to frontend types.
 */
export async function fetchIncidents(page = 1, limit = 20): Promise<IncidentsResponse> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/incidents?page=${page}&limit=${limit}`
    );
    const data = await res.json() as {
      incidents: Array<{
        id: number;
        title: string;
        description: string;
        severity: string;
        status: string;
        affectedServices: string;
        createdAt: string;
        resolvedAt: string | null;
      }>;
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };

    const incidents: Incident[] = data.incidents.map((i) => {
      let services: string[] = [];
      try { services = JSON.parse(i.affectedServices); } catch { /* non-JSON fallback */ }
      return {
        id: String(i.id),
        title: i.title,
        description: i.description,
        severity: i.severity as Incident['severity'],
        status: i.status as Incident['status'],
        affectedServices: services,
        startTime: Math.floor(new Date(i.createdAt).getTime() / 1000),
        resolvedTime: i.resolvedAt
          ? Math.floor(new Date(i.resolvedAt).getTime() / 1000)
          : undefined,
      };
    });

    return {
      incidents,
      total: data.pagination.total,
      page: data.pagination.page,
      pageSize: data.pagination.limit,
    };
  } catch (err) {
    console.error('Failed to fetch incidents:', err);
    return { incidents: [], total: 0, page, pageSize: limit };
  }
}

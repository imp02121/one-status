/**
 * Shared database schema — single source of truth for table/collection
 * names and record shapes across D1, PostgreSQL, and MongoDB.
 *
 * TypeScript types are re-exported from types.ts. This file adds
 * table name constants and column mappings used by migrations.
 */

export type {
  Incident,
  IncidentUpdate,
  Subscriber,
  IncidentSeverity,
  IncidentStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Table / collection names
// ---------------------------------------------------------------------------

export const TABLES = {
  incidents: "status_incidents",
  incidentUpdates: "status_incident_updates",
  subscribers: "status_subscribers",
  config: "status_config",
} as const;

// ---------------------------------------------------------------------------
// Enum values (used in CHECK constraints, validators, and application code)
// ---------------------------------------------------------------------------

export const INCIDENT_SEVERITIES = [
  "critical",
  "major",
  "minor",
  "maintenance",
] as const;

export const INCIDENT_STATUSES = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
] as const;

// ---------------------------------------------------------------------------
// Column definitions (for documentation / code-gen; mirrors the SQL schemas)
// ---------------------------------------------------------------------------

export const COLUMNS = {
  incidents: {
    id: "id",
    title: "title",
    description: "description",
    severity: "severity",
    status: "status",
    affectedServices: "affected_services",
    createdAt: "created_at",
    updatedAt: "updated_at",
    resolvedAt: "resolved_at",
  },
  incidentUpdates: {
    id: "id",
    incidentId: "incident_id",
    message: "message",
    status: "status",
    createdAt: "created_at",
  },
  subscribers: {
    id: "id",
    email: "email",
    verified: "verified",
    verifyToken: "verify_token",
    unsubscribeToken: "unsubscribe_token",
    createdAt: "created_at",
  },
  config: {
    key: "key",
    value: "value",
    updatedAt: "updated_at",
  },
} as const;

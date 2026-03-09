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
  Tenant,
  TenantService,
  TenantMember,
  TenantInvitation,
  ApiKey,
  TenantPlan,
  TenantMemberRole,
  CustomDomainStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Table / collection names
// ---------------------------------------------------------------------------

export const TABLES = {
  incidents: "status_incidents",
  incidentUpdates: "status_incident_updates",
  subscribers: "status_subscribers",
  config: "status_config",
  tenants: "tenants",
  tenantServices: "tenant_services",
  tenantMembers: "tenant_members",
  tenantInvitations: "tenant_invitations",
  apiKeys: "api_keys",
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
    tenantId: "tenant_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
    resolvedAt: "resolved_at",
  },
  incidentUpdates: {
    id: "id",
    incidentId: "incident_id",
    message: "message",
    status: "status",
    tenantId: "tenant_id",
    createdAt: "created_at",
  },
  subscribers: {
    id: "id",
    email: "email",
    verified: "verified",
    verifyToken: "verify_token",
    unsubscribeToken: "unsubscribe_token",
    tenantId: "tenant_id",
    createdAt: "created_at",
  },
  config: {
    key: "key",
    value: "value",
    updatedAt: "updated_at",
  },
  tenants: {
    id: "id",
    name: "name",
    slug: "slug",
    plan: "plan",
    ownerId: "owner_id",
    customDomain: "custom_domain",
    customDomainStatus: "custom_domain_status",
    brandingLogoUrl: "branding_logo_url",
    brandingColor: "branding_color",
    brandingShowBadge: "branding_show_badge",
    createdAt: "created_at",
  },
  tenantServices: {
    id: "id",
    tenantId: "tenant_id",
    slug: "slug",
    name: "name",
    url: "url",
    checkType: "check_type",
    enabled: "enabled",
  },
  tenantMembers: {
    tenantId: "tenant_id",
    userId: "user_id",
    role: "role",
    invitedBy: "invited_by",
    joinedAt: "joined_at",
  },
  tenantInvitations: {
    id: "id",
    tenantId: "tenant_id",
    email: "email",
    role: "role",
    token: "token",
    invitedBy: "invited_by",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
  apiKeys: {
    id: "id",
    tenantId: "tenant_id",
    name: "name",
    keyHash: "key_hash",
    keyPrefix: "key_prefix",
    scopes: "scopes",
    lastUsedAt: "last_used_at",
    expiresAt: "expires_at",
    createdAt: "created_at",
  },
} as const;

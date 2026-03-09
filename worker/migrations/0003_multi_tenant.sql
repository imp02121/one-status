-- Multi-tenancy: tenants, services, members, invitations, API keys
-- Adds tenant_id to existing tables for per-tenant isolation

-- ==========================================================================
-- New tables
-- ==========================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  owner_id TEXT NOT NULL,
  custom_domain TEXT,
  custom_domain_status TEXT DEFAULT 'none',
  branding_logo_url TEXT,
  branding_color TEXT DEFAULT '#4F46E5',
  branding_show_badge INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenant_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  check_type TEXT NOT NULL DEFAULT 'head',
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, slug),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  invited_by TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(tenant_id, user_id),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS tenant_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '["admin"]',
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- ==========================================================================
-- Add tenant_id to existing tables
-- ==========================================================================

ALTER TABLE status_incidents ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE status_incident_updates ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE status_subscribers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';

-- ==========================================================================
-- Indexes
-- ==========================================================================

CREATE INDEX idx_incidents_tenant ON status_incidents(tenant_id);
CREATE INDEX idx_incident_updates_tenant ON status_incident_updates(tenant_id);
CREATE INDEX idx_subscribers_tenant ON status_subscribers(tenant_id);
CREATE INDEX idx_tenant_services_tenant ON tenant_services(tenant_id);
CREATE INDEX idx_tenant_members_tenant ON tenant_members(tenant_id);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_custom_domain ON tenants(custom_domain);

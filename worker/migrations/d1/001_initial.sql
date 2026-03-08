-- BundleNudge Status Page — D1 (Cloudflare SQLite) schema
-- Run: wrangler d1 execute bundlenudge-status-db --file=migrations/d1/001_initial.sql

-- Incidents: track service disruptions and maintenance windows
CREATE TABLE IF NOT EXISTS status_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('critical', 'major', 'minor', 'maintenance')),
  status TEXT NOT NULL DEFAULT 'investigating'
    CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  affected_services TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON status_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON status_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON status_incidents(severity);

-- Incident updates: timeline entries for each incident
CREATE TABLE IF NOT EXISTS status_incident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_incident_updates_incident
  ON status_incident_updates(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_updates_created
  ON status_incident_updates(created_at DESC);

-- Subscribers: email notification recipients
CREATE TABLE IF NOT EXISTS status_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  unsubscribe_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON status_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_verify ON status_subscribers(verify_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_unsub ON status_subscribers(unsubscribe_token);

-- Config: key-value store for settings (alternative to KV for DB-backed config)
CREATE TABLE IF NOT EXISTS status_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

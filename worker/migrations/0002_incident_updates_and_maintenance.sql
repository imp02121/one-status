-- Add incident_updates table and maintenance severity

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

-- Recreate incidents table with maintenance severity
-- SQLite doesn't support ALTER CHECK, so we drop and recreate
-- This is safe for a fresh/dev database; production would need a migration strategy

-- Drop old table and recreate with maintenance severity
DROP TABLE IF EXISTS status_incidents;

CREATE TABLE status_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'investigating'
    CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('minor', 'major', 'critical', 'maintenance')),
  affected_services TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX idx_incidents_status ON status_incidents(status);
CREATE INDEX idx_incidents_created ON status_incidents(created_at DESC);
CREATE INDEX idx_incidents_severity ON status_incidents(severity);

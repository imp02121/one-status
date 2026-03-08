-- BundleNudge Status Page — PostgreSQL schema
-- Run: psql -d statuspage -f 001_initial.sql

-- Custom enum types
CREATE TYPE incident_severity AS ENUM ('critical', 'major', 'minor', 'maintenance');
CREATE TYPE incident_status AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');

-- Incidents: track service disruptions and maintenance windows
CREATE TABLE IF NOT EXISTS status_incidents (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity incident_severity NOT NULL DEFAULT 'minor',
  status incident_status NOT NULL DEFAULT 'investigating',
  affected_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON status_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON status_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON status_incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_affected ON status_incidents USING GIN (affected_services);

-- Incident updates: timeline entries for each incident
CREATE TABLE IF NOT EXISTS status_incident_updates (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status incident_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_updates_incident
  ON status_incident_updates(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_updates_created
  ON status_incident_updates(created_at DESC);

-- Subscribers: email notification recipients
CREATE TABLE IF NOT EXISTS status_subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verify_token VARCHAR(36),
  unsubscribe_token VARCHAR(36),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON status_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_verify ON status_subscribers(verify_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_unsub ON status_subscribers(unsubscribe_token);

-- Config: key-value store for settings
CREATE TABLE IF NOT EXISTS status_config (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON status_incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_config_updated_at
  BEFORE UPDATE ON status_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

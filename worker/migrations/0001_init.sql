-- Status page D1 schema: incidents + subscribers

CREATE TABLE IF NOT EXISTS status_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'investigating'
    CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('minor', 'major', 'critical')),
  affected_services TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON status_incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON status_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON status_incidents(severity);

CREATE TABLE IF NOT EXISTS status_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscribers_email ON status_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_verify ON status_subscribers(verify_token);
CREATE INDEX IF NOT EXISTS idx_subscribers_unsub ON status_subscribers(unsubscribe_token);

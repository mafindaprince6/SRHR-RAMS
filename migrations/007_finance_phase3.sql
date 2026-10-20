-- Phase 3 financial accountability. Apply after 006_paperless.sql.

CREATE TABLE IF NOT EXISTS usd_rate_history(
  id TEXT PRIMARY KEY,
  rate REAL NOT NULL,
  effective_at TEXT NOT NULL,
  source TEXT,
  changed_by INTEGER REFERENCES users(id),
  changed_by_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usd_rate_history_at ON usd_rate_history(effective_at);

CREATE TABLE IF NOT EXISTS disbursement_keys(
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  disbursement_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS deliverables(
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  title TEXT NOT NULL,
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  evidence_note TEXT,
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliverables_request ON deliverables(request_id);

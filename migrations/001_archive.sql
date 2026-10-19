-- Additive archive migration. Do not run schema.sql on an existing database.
-- Apply with: npx wrangler d1 execute srhr-rams-db --remote --file=migrations/001_archive.sql

CREATE TABLE IF NOT EXISTS request_numbers(
  year INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL
);

ALTER TABLE requests ADD COLUMN funding_source TEXT;
ALTER TABLE requests ADD COLUMN fiscal_year TEXT;
ALTER TABLE requests ADD COLUMN approved_amount_nle REAL;
ALTER TABLE requests ADD COLUMN rate_snapshot REAL;
ALTER TABLE requests ADD COLUMN rate_snapshot_at TEXT;
ALTER TABLE requests ADD COLUMN archival_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE requests ADD COLUMN classification TEXT;
ALTER TABLE requests ADD COLUMN retention_category TEXT;
ALTER TABLE requests ADD COLUMN legal_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN closed_at TEXT;
ALTER TABLE requests ADD COLUMN submitted_at TEXT;
ALTER TABLE requests ADD COLUMN approved_at TEXT;
ALTER TABLE requests ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS request_events(
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  from_stage TEXT,
  to_stage TEXT,
  note TEXT,
  request_version INTEGER,
  created_at TEXT NOT NULL
);

ALTER TABLE documents ADD COLUMN category TEXT;
ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN checksum_sha256 TEXT;
ALTER TABLE documents ADD COLUMN size_bytes INTEGER;
ALTER TABLE documents ADD COLUMN superseded_at TEXT;
ALTER TABLE documents ADD COLUMN superseded_by TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_fiscal ON requests(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_requests_funding ON requests(funding_source);
CREATE INDEX IF NOT EXISTS idx_documents_request ON documents(request_id);
CREATE INDEX IF NOT EXISTS idx_events_request ON request_events(request_id, created_at);

INSERT INTO request_numbers(year, last_seq)
SELECT CAST(substr(request_number, 6, 4) AS INTEGER),
       MAX(CAST(substr(request_number, 11) AS INTEGER))
FROM requests
WHERE request_number GLOB 'SRHR-[0-9][0-9][0-9][0-9]-*'
GROUP BY substr(request_number, 6, 4);

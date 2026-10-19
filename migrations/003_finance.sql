-- Financial accountability: disbursements linked to approved funding.
-- Apply after 001_archive.sql and 002_workflow.sql:
-- npx wrangler d1 execute srhr-rams-db --local --file=migrations/003_finance.sql

CREATE TABLE IF NOT EXISTS disbursements(
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  reference_number TEXT NOT NULL,
  amount_nle REAL NOT NULL,
  rate_snapshot REAL,
  rate_snapshot_at TEXT,
  recorded_by INTEGER REFERENCES users(id),
  comments TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_disbursements_request ON disbursements(request_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_disbursements_active_ref ON disbursements(request_id, reference_number) WHERE voided_at IS NULL;

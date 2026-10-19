-- Idempotency for request submission. Safe to run more than once.
-- Apply after 001_archive.sql:
-- npx wrangler d1 execute srhr-rams-db --local --file=migrations/002_workflow.sql

CREATE TABLE IF NOT EXISTS idempotency_keys(
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

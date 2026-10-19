-- Records retention, legal hold metadata, and policy catalogue.
-- Apply after 003_finance.sql:
-- npx wrangler d1 execute srhr-rams-db --local --file=migrations/004_retention.sql

CREATE TABLE IF NOT EXISTS retention_policies(
  category TEXT PRIMARY KEY,
  retention_years INTEGER NOT NULL,
  description TEXT NOT NULL
);

INSERT OR IGNORE INTO retention_policies(category, retention_years, description) VALUES
('operational', 5, 'Operational activity files'),
('procurement', 7, 'Procurement and contract files'),
('financial', 7, 'Payment, receipt and liquidation evidence'),
('default', 5, 'General SRHR project records');

ALTER TABLE requests ADD COLUMN retention_until TEXT;
ALTER TABLE requests ADD COLUMN legal_hold_reason TEXT;
ALTER TABLE requests ADD COLUMN legal_hold_at TEXT;
ALTER TABLE requests ADD COLUMN legal_hold_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_requests_retention ON requests(retention_until, archival_status);
CREATE INDEX IF NOT EXISTS idx_requests_legal_hold ON requests(legal_hold);

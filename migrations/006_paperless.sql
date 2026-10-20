-- Paperless records: generated decision storage and configurable submission rules.
-- Apply after 005_queues.sql:
-- npx wrangler d1 execute srhr-rams-db --local --file=migrations/006_paperless.sql

ALTER TABLE documents ADD COLUMN inline_body TEXT;

INSERT OR IGNORE INTO system_settings(key,value,updated_at) VALUES(
  'submission_requirements',
  '{"min_details_length":10,"min_budget_lines":1,"min_budget_total":0.01,"require_concept_note":true,"concept_min_fields":["background","goal"],"require_deliverable":true,"require_timeline":true,"require_activity_code":false,"require_funding_source":false,"enforce_on_direct_submit":false}',
  CURRENT_TIMESTAMP
);

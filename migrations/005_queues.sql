-- Queue performance indexes (optional; safe to re-run).
-- Apply after 004_retention.sql:
-- npx wrangler d1 execute srhr-rams-db --local --file=migrations/005_queues.sql

CREATE INDEX IF NOT EXISTS idx_requests_queue ON requests(current_stage, status, submitted_at);

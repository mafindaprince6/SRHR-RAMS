-- Filed annual work plans. A later filing for the same directorate and year supersedes the previous copy.
CREATE TABLE IF NOT EXISTS awp_submissions(
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('online','upload')),
  file_name TEXT,
  line_count INTEGER NOT NULL DEFAULT 0,
  total_budget_nle REAL NOT NULL DEFAULT 0,
  submitted_by INTEGER,
  submitted_at TEXT NOT NULL,
  superseded_at TEXT
);
CREATE TABLE IF NOT EXISTS awp_submission_lines(
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  activity_code TEXT NOT NULL,
  title TEXT NOT NULL,
  budget_nle REAL NOT NULL DEFAULT 0,
  output TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_awp_submissions_entity ON awp_submissions(entity, fiscal_year, submitted_at);
CREATE INDEX IF NOT EXISTS idx_awp_submission_lines ON awp_submission_lines(submission_id, sort_order);

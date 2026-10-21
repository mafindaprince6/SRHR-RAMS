-- Directorate annual work plan lines. Other desks read them; only the owning directorate changes them.
CREATE TABLE IF NOT EXISTS awp_activities(
  id TEXT PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  entity TEXT NOT NULL,
  activity_code TEXT NOT NULL,
  title TEXT NOT NULL,
  budget_nle REAL NOT NULL DEFAULT 0,
  output TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_awp_entity_year ON awp_activities(entity, fiscal_year);

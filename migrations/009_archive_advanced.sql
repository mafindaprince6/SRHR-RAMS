-- Phase 5 archive search text and legacy import. Apply after 008_admin.sql.

CREATE TABLE IF NOT EXISTS document_extracts(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  source TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_extracts_request ON document_extracts(request_id);

CREATE TABLE IF NOT EXISTS legacy_import_keys(
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, key)
);

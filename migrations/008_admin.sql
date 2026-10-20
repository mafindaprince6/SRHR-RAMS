-- Phase 4 administration. Apply after 007_finance_phase3.sql.

ALTER TABLE users ADD COLUMN last_login_at TEXT;

CREATE TABLE IF NOT EXISTS role_permissions(
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY(role, permission)
);

INSERT OR IGNORE INTO role_permissions(role, permission) VALUES
('Directorate User','view_records'),
('Directorate User','create_requests'),
('Directorate User','edit_drafts'),
('Directorate User','submit_requests'),
('Project Secretary','view_records'),
('Project Secretary','review_requests'),
('Project Secretary','raise_query'),
('Project Secretary','export_records'),
('Chairman','view_records'),
('Chairman','approve_requests'),
('Chairman','raise_query'),
('Chairman','export_records'),
('IHPAU','view_records'),
('IHPAU','disburse_funds'),
('IHPAU','verify_receipts'),
('IHPAU','close_requests'),
('IHPAU','raise_query'),
('IHPAU','export_records'),
('Administrator','view_records'),
('Administrator','create_requests'),
('Administrator','edit_drafts'),
('Administrator','submit_requests'),
('Administrator','review_requests'),
('Administrator','approve_requests'),
('Administrator','disburse_funds'),
('Administrator','verify_receipts'),
('Administrator','close_requests'),
('Administrator','raise_query'),
('Administrator','manage_users'),
('Administrator','manage_retention'),
('Administrator','export_records'),
('Administrator','configure_system');

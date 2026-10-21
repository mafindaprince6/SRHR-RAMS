# Stage 7 verification checklist

Use this after migrations and before or immediately after a production deploy.

## Automated

| Check | Command | Expected |
|--------|---------|----------|
| Worker syntax | `node --check src/index.js` | Exit 0 |
| Test suite | `node --test tests/*.test.mjs` | 45 pass, 0 fail |

## Migrations (existing D1)

- [ ] `001_archive.sql` applied (archive search, documents metadata, request events)
- [ ] `002_workflow.sql` applied (idempotency keys)
- [ ] `003_finance.sql` applied (disbursements)
- [ ] `004_retention.sql` applied (retention policies, legal hold fields)

Confirm with a query or by hitting `/api/archive` (not 503 migration_required).

## Authorization (manual)

- [ ] Unauthenticated `/api/requests` → 401
- [ ] Directorate cannot approve own request → 403
- [ ] Close blocked with legal hold, pending receipts, or disbursement mismatch → 409
- [ ] Administrator record control requires reason → 400 without note

## Features delivered (Stages 3–6)

| Area | Key files | Tests |
|------|-----------|-------|
| Archive search & documents | `src/index.js`, `public/archive.js`, `migrations/001_archive.sql` | `tests/archive.test.mjs` |
| Paperless workflow | `src/index.js`, `public/workflow.js`, `migrations/002_workflow.sql` | `tests/workflow.test.mjs` |
| Financial accountability | `migrations/003_finance.sql`, `public/workflow.js` | `tests/finance-accountability.test.mjs` |
| Retention & reporting | `migrations/004_retention.sql`, `public/reports.js`, `docs/RECOVERY.md` | `tests/retention-reporting.test.mjs` |
| USD rate & budget UI | `public/finance.js` | `tests/finance-rate.test.mjs`, `tests/finance-ui.test.mjs` |

## CI

On push to `main` or `maliaka`, GitHub Actions runs `node --check src/index.js` and the full test suite.

## Known limitations

- Excel/PDF concept-note extraction remains stubbed in the UI.
- The workflow desks are fixed. Legal hold, entities, the annual work plan, the request prefix, reminder values, deliverables, record control, audit, and archive use the live API. Menu checkboxes only hide screens in this browser. Due deliverables and unmatched disbursements can store in-app reminders. Email, SMS, and WhatsApp are not sent.
- Document storage requires R2 binding `DOCUMENTS` (not in default `wrangler.jsonc`).
- Retention years in `retention_policies` are catalogue defaults until the Ministry publishes official schedules.

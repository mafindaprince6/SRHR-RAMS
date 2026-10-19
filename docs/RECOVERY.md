# SRHR-RAMS recovery notes

## Database backups

Use Cloudflare D1 export before major migrations or releases:

```powershell
npx wrangler d1 export srhr-rams-db --local --output=backup-local.sql
```

Restore into a fresh local database by applying `schema.sql`, then the backup file, or by replaying migrations in order under `migrations/`.

## Migration order

1. `migrations/001_archive.sql`
2. `migrations/002_workflow.sql`
3. `migrations/003_finance.sql`
4. `migrations/004_retention.sql`

## Audit integrity

Administrators can run **Audit & Recovery → Check integrity** (or `GET /api/admin/audit/integrity`) to sample for:

- Closed requests missing a `CLOSE` workflow event
- Submitted requests with no workflow history
- Legal holds without a matching `RECORD_LEGAL_HOLD` audit entry
- Audit rows pointing at deleted requests

Fix data through controlled record actions (`POST /api/admin/records/:id/control`) or desk workflow; do not delete audit rows.

## Document storage

If the `DOCUMENTS` R2 binding is missing, uploads fail safely and no orphan metadata is kept. Re-bind R2 and re-upload evidence where required.

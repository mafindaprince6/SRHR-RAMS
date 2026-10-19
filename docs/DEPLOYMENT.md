# SRHR-RAMS deployment and rollback

## Preconditions

- Cloudflare account with Wrangler authenticated (`npx wrangler whoami`).
- Existing D1 database `srhr-rams-db` (see `wrangler.jsonc`). **Do not** run `schema.sql` on production; it recreates tables and seed data.
- Optional: R2 bucket bound as `DOCUMENTS` for file uploads (without it, uploads fail safely and no orphan metadata is kept).

## Verify before deploy

From the project root:

```powershell
node --check src/index.js
node --test tests/*.test.mjs
```

All tests should pass (23 as of Stage 7).

## Apply migrations (production D1)

Run in order on the **remote** database, once per environment:

```powershell
npx wrangler d1 execute srhr-rams-db --remote --file=migrations/001_archive.sql
npx wrangler d1 execute srhr-rams-db --remote --file=migrations/002_workflow.sql
npx wrangler d1 execute srhr-rams-db --remote --file=migrations/003_finance.sql
npx wrangler d1 execute srhr-rams-db --remote --file=migrations/004_retention.sql
```

Local development:

```powershell
npx wrangler d1 execute srhr-rams-db --local --file=migrations/001_archive.sql
npx wrangler d1 execute srhr-rams-db --local --file=migrations/002_workflow.sql
npx wrangler d1 execute srhr-rams-db --local --file=migrations/003_finance.sql
npx wrangler d1 execute srhr-rams-db --local --file=migrations/004_retention.sql
```

Migrations are additive (`IF NOT EXISTS` / `ADD COLUMN`). Re-running a file may error on duplicate columns; that usually means it was already applied.

## Deploy Worker + static assets

```powershell
npm run deploy
```

Or: `npx wrangler deploy`

## Rollback

1. **Worker code:** redeploy the previous git tag or commit (`git checkout <sha>` then `npm run deploy`). Worker rollback does not undo D1 data changes.
2. **Database:** restore from a D1 export taken before migration (see `docs/RECOVERY.md`). There is no automatic down-migration.
3. **Documents:** R2 objects are not removed by Worker rollback; reconcile manually if a bad deploy uploaded files.

## Post-deploy smoke checks

1. `GET /api/health` returns `ok: true`.
2. Sign in as each role; confirm archive search and desk queues load.
3. IHPAU: save USD rate; create a test request through submit → close path on a non-production clone first.
4. Administrator: **Audit & Recovery → Check integrity** should report no issues on a healthy database.

## Security notes

- Session cookie: `srhr_session`, HttpOnly, Secure, SameSite=Strict, 8-hour TTL.
- API routes under `/api/` require authentication except login and health.
- Directorate users cannot see other entities’ drafts; workflow actions are enforced server-side.
- Change default seed passwords before production use (`update-passwords.sql` is for controlled resets only).

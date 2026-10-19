# SRHR-RAMS: retention, reporting and recovery

Retention policies live in `retention_policies`. Closing a request sets `retention_until` from its category. Administrators apply legal holds through **Records & Legal Hold** (`POST /api/admin/records/:id/control`). Management reports are at `/api/reports/management`. Recovery steps are in `docs/RECOVERY.md`.

Apply after the finance migration:

```powershell
npx wrangler d1 execute srhr-rams-db --local --file=migrations/004_retention.sql
```

# SRHR-RAMS: financial accountability

Disbursements are recorded separately from receipts. Each disbursement keeps the exchange rate saved with the request. Closing a funded request requires disbursements to match the approved amount and verified receipts to match disbursements. Apply after the workflow migration:

```powershell
npx wrangler d1 execute srhr-rams-db --local --file=migrations/003_finance.sql
```

# SRHR-RAMS: paperless workflow

A request can change stage only while it is at the desk allowed to make that decision. Queries, rejections, withdrawals, and receipt verification require a reason. The Chairman cannot approve a request they created. Finance status has to be one of the named steps. Closing is refused when a legal hold is set or a receipt is still pending. Rejected and withdrawn requests stay in the archive.

An administrator can perform a desk action only with a written reason, and still cannot skip a stage. Repeating a decision that is already recorded does not add another workflow event. A repeated save uses an idempotency key so the second click returns the original reference. Apply this after the archive migration:

```powershell
npx wrangler d1 execute srhr-rams-db --local --file=migrations/002_workflow.sql
```

Use `--remote` only for the live database, and export a backup first. The new table can stay in place if you roll the Worker back. Excel and Word extraction are not connected; the online form is the path that creates a record.

# SRHR-RAMS: records archive

Stage 3 adds a permanent request-number sequence, role-scoped archive search, and document metadata. Existing rows are kept. Do not run `schema.sql` on a live database.

Apply the migration before using the archive:

```powershell
npx wrangler d1 execute srhr-rams-db --remote --file=migrations/001_archive.sql
```

Use `--local` instead of `--remote` for the local development database. Take a D1 export or backup before applying it. Rollback is to deploy the previous Worker and leave the new tables in place. Added columns are not dropped automatically.

Document bytes are not stored in D1. Uploads return a clear unavailable response until a private R2 bucket is bound as `DOCUMENTS` in `wrangler.jsonc`. Do not add that binding until the bucket exists, and do not make the bucket public.

```jsonc
"r2_buckets": [{"binding": "DOCUMENTS", "bucket_name": "srhr-rams-documents"}]
```

The live USD rate is copied onto a request at submission. Later rate changes do not rewrite that saved rate. Full-text search, OCR, PDF dossiers, retention periods, and liquidation rules are not part of this stage.

# SRHR-RAMS: shared USD rate and request budget total

IHPAU can save the NLe amount per 1 USD in IHPAU Desk. Administrator retains override access. Directorate Dashboard, the request form and Project Secretary Desk show this shared rate with an update timestamp. Signed-in visible screens refresh every 15 seconds and when returning to the app. Unsaved rate input is preserved while polling.

The top of the request form shows the Summary Budget Total in NLe and a reference USD equivalent at the current rate. Budget lines calculate Unit × Qty/Days × Unit Cost, with each line rounded to two decimal places. Changing quantity or cost updates top and bottom totals. Invalid inputs show a correction message. Rate changes do not rewrite stored requests.

This update uses the existing system_settings table; no schema reset or migration is needed. Other existing prototype functionality has not been rebuilt.

Validation: six automated API and form-logic tests, JavaScript syntax checks, SQLite insert/update checks passed. Browser rendering was not verified because a browser executable was unavailable.

## Apply to your existing GitHub checkout
1. Open PowerShell inside your SRHR-RAMS repository folder and run `git pull`.
2. Copy the contents of this update folder into the repository, replacing matching files. Keep the repository .git directory.
3. Run:

```powershell
node --test tests/*.test.mjs
git add src/index.js public/index.html public/finance.js tests UPDATE-NOTES.md
git commit -m "Add shared IHPAU USD rate and request budget summary"
git push origin main
```

Deploy through your existing Cloudflare process after reviewing the pushed source. A GitHub push alone does not deploy this Worker unless you have configured automatic deployment. Do not execute schema.sql on the existing live database.

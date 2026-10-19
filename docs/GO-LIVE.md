# Go-live runbook (operator)

Complete these steps once per environment. Wrangler must be authenticated (`npx wrangler login`).

**Windows PowerShell:** If you see *running scripts is disabled*, use the `.cmd` shims (`npx.cmd`, `npm.cmd`) or run commands from **Command Prompt**, not PowerShell. Example: `npx.cmd wrangler login`.

## 1. Merge code

Ensure `main` on GitHub includes the `maliaka` work and CI is green.

## 2. Backup remote D1

```powershell
cd SRHR-RAMS
npx.cmd wrangler d1 export srhr-rams-db --remote --output=backup-before-migrate.sql
```

Store the file securely (Ministry IT, not in a public repo).

## 3. Apply migrations (remote)

```powershell
scripts\apply-migrations.cmd -Remote
```

If a step reports duplicate column/table, it was likely applied already — continue.

## 4. Deploy Worker

**First time on this Cloudflare account:** register a `workers.dev` subdomain (one-time):

https://dash.cloudflare.com/0daeed2232ffe71c6a7a1bc7b25c8c77/workers/onboarding

Or run interactively and accept the prompt:

```powershell
npx.cmd wrangler deploy
```

Use `npx.cmd wrangler deploy` (not bare `npm run deploy`) if `wrangler` is not on your PATH.

Note the `*.workers.dev` or custom hostname URL.

### Fresh D1 on a new account

If remote export fails with *database could not be found*, create a database and update `wrangler.jsonc`:

```powershell
npx.cmd wrangler d1 create srhr-rams-db
npx.cmd wrangler d1 execute srhr-rams-db --remote --file=schema.sql
scripts\apply-migrations.cmd -Remote
```

## 5. Smoke test

| Check | How |
|-------|-----|
| Health | Open `/api/health` → `"ok": true` |
| Login | Each demo role (change passwords in production) |
| Dashboard | Counts and recent list update after login |
| Archive | Search returns records (not migration 503) |
| IHPAU | Disburse → receipt → verify → close on a **test** request |
| Admin | Audit → Check integrity → no issues |

## 6. Optional: document storage (R2)

```powershell
npx wrangler r2 bucket create srhr-rams-documents
```

Add to `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "DOCUMENTS", "bucket_name": "srhr-rams-documents" }]
```

Redeploy. Keep the bucket **private**.

## 7. Rollback

Redeploy the previous Worker version from git. Restore D1 only from the backup export if data was corrupted — see `docs/DEPLOYMENT.md`.

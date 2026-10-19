# SRHR-RAMS

Sexual and Reproductive Health and Rights — Request & Activity Management System for the Ministry of Health, Sierra Leone.

**Stack:** Cloudflare Worker (`src/index.js`), D1 SQLite, static frontend (`public/`), session-based RBAC.

## Quick start (local)

```powershell
npm install
npx wrangler dev
```

Apply D1 migrations to the local database (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Default demo accounts are in `schema.sql` (local fresh DB only).

## Verify

```powershell
npm run check
npm test
```

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the full Stage 7 checklist.

## Documentation

| Document | Purpose |
|----------|---------|
| [UPDATE-NOTES.md](UPDATE-NOTES.md) | Migration order and feature notes by stage |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy, rollback, smoke tests |
| [docs/RECOVERY.md](docs/RECOVERY.md) | Backup, integrity checks, legal hold |
| [docs/GO-LIVE.md](docs/GO-LIVE.md) | Operator runbook (login, migrate, deploy) |

## Project layout

- `src/index.js` — API, workflow, archive, finance, retention, reports
- `public/` — UI (`index.html`, `workflow.js`, `archive.js`, `reports.js`, `finance.js`)
- `migrations/` — additive D1 migrations (001–004)
- `tests/` — Node test runner + in-memory SQLite D1 shim

## Production database

**Do not** run `schema.sql` against an existing production D1 database. Use only the files in `migrations/` on live data. Export a backup before migrating (see RECOVERY.md).

## GitHub

Remote: `https://github.com/mafindaprince6/SRHR-RAMS.git`

Active development branch: **`maliaka`**. Merge into **`main`** when ready:

1. Open [Compare & pull request](https://github.com/mafindaprince6/SRHR-RAMS/compare/main...maliaka) on GitHub.
2. Confirm CI checks pass.
3. Merge, then deploy from `main` and run `.\scripts\apply-migrations.ps1 -Remote` once.

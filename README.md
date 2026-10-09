# SRHR-RAMS

Recovered Cloudflare Worker + D1 project, packaged for GitHub.

## Contents
- `src/index.js`: server authentication, API and workflow.
- `public/index.html`: application interface, with responsive CSS repairs.
- `schema.sql`: schema and sample account seed data.
- `wrangler.jsonc`: existing Cloudflare application and D1 binding.

## Validation and limits
The Worker and inline browser scripts passed syntax checks during packaging. This is recovered source, not a verified fresh rebuild or a confirmation of the live deployment. Some interface features still use browser local storage and demonstration data. Full end-to-end verification remains necessary. The temporary unauthenticated recovery endpoint and recovery scripts have been removed.

## Existing live database
Do not run `schema.sql` against the existing database. It contains CREATE statements and seed accounts. Preserve the existing D1 database. Do not deploy merely to upload code to GitHub.

## Upload using PowerShell
Run inside this extracted folder:

```powershell
git init
git branch -M main
git add .
git commit -m "Add recovered SRHR-RAMS source"
git remote add origin https://github.com/mafindaprince6/SRHR-RAMS.git
git push -u origin main
```

Sign in to GitHub when prompted. The commands assume the remote repository remains empty. Do not force push if Git reports a conflict.

## Cloudflare
Use your authenticated Cloudflare account with Wrangler. Review the D1 binding before any deployment. This package retains the existing database identifier but includes no Cloudflare API token. Existing user credentials remain in the existing database; the package does not reset them.

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

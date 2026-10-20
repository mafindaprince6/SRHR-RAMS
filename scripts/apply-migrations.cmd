@echo off
setlocal
cd /d "%~dp0.."
set "FLAG=--local"
if /I "%~1"=="-Remote" set "FLAG=--remote"
echo Target D1: srhr-rams-db %FLAG%
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/001_archive.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/002_workflow.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/003_finance.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/004_retention.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/005_queues.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/006_paperless.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/007_finance_phase3.sql
call npx.cmd wrangler d1 execute srhr-rams-db %FLAG% --file=migrations/008_admin.sql
echo Done. If a step failed with duplicate column/table, that migration was likely already applied.
endlocal

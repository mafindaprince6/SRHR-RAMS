# Apply SRHR-RAMS D1 migrations in order.
# Usage:
#   .\scripts\apply-migrations.ps1              # local D1
#   .\scripts\apply-migrations.ps1 -Remote      # production D1 (requires wrangler auth)

param(
  [switch]$Remote
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$flag = if ($Remote) { "--remote" } else { "--local" }
$files = @(
  "migrations/001_archive.sql",
  "migrations/002_workflow.sql",
  "migrations/003_finance.sql",
  "migrations/004_retention.sql",
  "migrations/005_queues.sql",
  "migrations/006_paperless.sql",
  "migrations/007_finance_phase3.sql",
  "migrations/008_admin.sql"
)

Write-Host "Target: $(if ($Remote) { 'remote' } else { 'local' }) D1 (srhr-rams-db)"

foreach ($file in $files) {
  Write-Host "`n>> $file"
  npx wrangler d1 execute srhr-rams-db $flag --file=$file
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Wrangler returned $LASTEXITCODE for $file (often means the migration was already applied)."
  }
}

Write-Host "`nDone. Run npm test and hit /api/health and /api/archive to confirm."

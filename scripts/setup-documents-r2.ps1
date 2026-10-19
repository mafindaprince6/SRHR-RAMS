# Creates the private R2 bucket for archive uploads.
# After this succeeds, add the r2_buckets block in wrangler.jsonc (see UPDATE-NOTES.md) and redeploy.

$ErrorActionPreference = "Stop"
Write-Host "Creating bucket srhr-rams-documents (skip if it already exists)..."
npx wrangler r2 bucket create srhr-rams-documents
Write-Host @"

Next steps:
1. Add to wrangler.jsonc:
   `"r2_buckets`": [{ `"binding`": `"DOCUMENTS`", `"bucket_name`": `"srhr-rams-documents`" }]
2. npm run deploy
"@

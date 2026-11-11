$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\load-env.ps1"
if (-not $env:DATABASE_URL -or $env:DATABASE_URL -match 'USER:PASSWORD@HOST|your-database-url') {
  throw 'DATABASE_URL is missing or still a placeholder. Put your PostgreSQL connection string in .env first.'
}
Write-Host 'Creating/updating PayPilot tables in the configured PostgreSQL database...' -ForegroundColor Cyan
pnpm --filter @workspace/db run push
if ($LASTEXITCODE -ne 0) { throw 'Database schema setup failed. Check DATABASE_URL and database access.' }
Write-Host 'Database schema setup completed.' -ForegroundColor Green

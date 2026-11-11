$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\load-env.ps1"
if (-not $env:DATABASE_URL -or $env:DATABASE_URL -match 'USER:PASSWORD@HOST|your-database-url') {
  throw 'DATABASE_URL is missing or still a placeholder. Add a PostgreSQL connection string to .env first.'
}
if (-not $env:PORT) { $env:PORT = '8080' }
$env:NODE_ENV = 'development'
Write-Host "Building PayPilot API..." -ForegroundColor Cyan
pnpm --filter @workspace/api-server run build
if ($LASTEXITCODE -ne 0) { throw 'API build failed. See the build error above.' }
Write-Host "Starting PayPilot API on http://127.0.0.1:$env:PORT ..." -ForegroundColor Green
pnpm --filter @workspace/api-server run start

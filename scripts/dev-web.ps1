$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
. "$PSScriptRoot\load-env.ps1"
if (-not $env:WEB_PORT) { $env:WEB_PORT = '23943' }
if (-not $env:PAYPILOT_API_URL) { $env:PAYPILOT_API_URL = 'http://127.0.0.1:8080' }
Write-Host "Starting PayPilot web app on http://localhost:$env:WEB_PORT ..." -ForegroundColor Green
pnpm --filter @workspace/paypilot-ai run dev

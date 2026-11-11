$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Invoke-Check([string]$Label, [string]$Command, [string[]]$Arguments) {
  Write-Host "`n===== $Label =====" -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE. Stop here and inspect the output above."
  }
  Write-Host "$Label passed." -ForegroundColor Green
}

Invoke-Check 'Monorepo typecheck' 'pnpm' @('run', 'typecheck')
Invoke-Check 'Unit tests' 'pnpm' @('test')
Invoke-Check 'API end-to-end tests' 'pnpm' @('--filter', '@workspace/api-server', 'run', 'test:e2e')
Invoke-Check 'Production builds' 'pnpm' @('run', 'build')

Write-Host "`nAll local verification commands passed. Live Gemini and PayPal Sandbox checks still require valid credentials and a real provider run." -ForegroundColor Green

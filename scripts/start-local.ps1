$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example. Edit it now and replace the PostgreSQL and API credential placeholders.' -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList (Join-Path $projectRoot '.env') -Wait
}
. "$PSScriptRoot\load-env.ps1"
if (-not $env:DATABASE_URL -or $env:DATABASE_URL -match 'USER:PASSWORD@HOST|your-database-url') {
  throw 'Set a real PostgreSQL DATABASE_URL in .env before starting PayPilot.'
}
$setupScript = Join-Path $PSScriptRoot 'setup-db.ps1'
Write-Host 'Preparing the database schema...' -ForegroundColor Cyan
& $setupScript
if ($LASTEXITCODE -ne 0) { throw 'Database setup failed. Fix DATABASE_URL and run scripts/setup-db.ps1 again.' }
$apiScript = Join-Path $PSScriptRoot 'dev-api.ps1'
$webScript = Join-Path $PSScriptRoot 'dev-web.ps1'
$apiArgs = "-NoExit -ExecutionPolicy Bypass -File `"$apiScript`""
$webArgs = "-NoExit -ExecutionPolicy Bypass -File `"$webScript`""
Start-Process -FilePath 'powershell.exe' -ArgumentList $apiArgs -WorkingDirectory $projectRoot
Start-Sleep -Seconds 2
Start-Process -FilePath 'powershell.exe' -ArgumentList $webArgs -WorkingDirectory $projectRoot
Write-Host 'Started API and web servers in separate PowerShell windows. Open http://localhost:23943.' -ForegroundColor Green

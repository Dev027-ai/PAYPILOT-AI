param(
  [string]$BaseUrl = 'http://localhost:8080'
)
$ErrorActionPreference = 'Continue'
$checks = @(
  @{ Name = 'Runtime diagnostics'; Path = '/api/settings/diagnostics' },
  @{ Name = 'Overview'; Path = '/api/overview' },
  @{ Name = 'Transactions'; Path = '/api/transactions' },
  @{ Name = 'Monthly analytics'; Path = '/api/analytics/spending?period=month' },
  @{ Name = 'Product catalog'; Path = '/api/catalog/products' },
  @{ Name = 'Integration status'; Path = '/api/settings/status' }
)

foreach ($check in $checks) {
  Write-Host "`n===== $($check.Name) =====" -ForegroundColor Cyan
  try {
    $response = Invoke-WebRequest -Uri ($BaseUrl.TrimEnd('/') + $check.Path) -UseBasicParsing -TimeoutSec 15
    Write-Host "HTTP $([int]$response.StatusCode)" -ForegroundColor Green
    try { $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 8 } catch { $response.Content }
  }
  catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'No HTTP response' }
    Write-Host "FAILED: $status — $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  }
}

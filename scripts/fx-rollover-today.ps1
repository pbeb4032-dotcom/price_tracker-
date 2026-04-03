$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# Read secret from .env
$line = (Select-String -Path ".env" -Pattern "INTERNAL_JOB_SECRET" -SimpleMatch | Select-Object -First 1).Line
if (-not $line) { throw "INTERNAL_JOB_SECRET not found in .env" }
$secret = ($line -split "=",2)[1].Trim().Trim('"')

$url = "http://localhost:8787/admin/jobs/fx_rollover_today"

Write-Host "Calling: $url"
Invoke-RestMethod -Method Post -Uri $url -Headers @{
  "Content-Type" = "application/json"
  "x-job-secret" = $secret
} -Body "{}" | ConvertTo-Json -Depth 10

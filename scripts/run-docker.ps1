$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "[1/2] Starting FULL STACK (db+api+web+searxng) with Docker..."
docker compose -f docker-compose.full.yml up -d --build

Write-Host "[2/2] Done."
Write-Host "Web:   http://localhost:8080"
Write-Host "API:   http://localhost:8787/health"
Write-Host "Searx: http://localhost:8081"

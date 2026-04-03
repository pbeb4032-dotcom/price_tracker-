$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
node scripts/run-final-release-gate.mjs
$outDir = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outZip = Join-Path $outDir 'price-tracker-iraq-final-release.zip'
if (Test-Path $outZip) { Remove-Item $outZip -Force }
$tempDir = Join-Path $env:TEMP ('price-tracker-final-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
robocopy $root $tempDir /E /NFL /NDL /NJH /NJS /nc /ns /np /XD node_modules .git artifacts dist | Out-Null
if (Test-Path (Join-Path $tempDir 'api\node_modules')) { Remove-Item (Join-Path $tempDir 'api\node_modules') -Recurse -Force }
if (Test-Path (Join-Path $tempDir 'api\dist')) { Remove-Item (Join-Path $tempDir 'api\dist') -Recurse -Force }
Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $outZip -Force
Remove-Item $tempDir -Recurse -Force
Write-Host "created $outZip"

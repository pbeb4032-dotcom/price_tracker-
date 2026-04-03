param(
    [string]$ApiUrl = "http://localhost:8787",
    [int]$RequestsPerEndpoint = 20,
    [int]$BurstRequests = 80
)

$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[performance-benchmarks] $Message"
}

function Invoke-TimedRequest {
    param([string]$Path)

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = Invoke-WebRequest -Uri "$ApiUrl$Path" -Method Get -TimeoutSec 20 -UseBasicParsing
        $stopwatch.Stop()
        [pscustomobject]@{
            Path = $Path
            StatusCode = [int]$response.StatusCode
            DurationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
            Success = $true
        }
    }
    catch {
        $stopwatch.Stop()
        $statusCode = 0
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode.value__
        }
        [pscustomobject]@{
            Path = $Path
            StatusCode = $statusCode
            DurationMs = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
            Success = $false
        }
    }
}

function Measure-Endpoint {
    param([string]$Path)

    $results = for ($i = 0; $i -lt $RequestsPerEndpoint; $i++) {
        Invoke-TimedRequest -Path $Path
    }

    $durations = $results | ForEach-Object { $_.DurationMs }
    $successCount = ($results | Where-Object { $_.StatusCode -ge 200 -and $_.StatusCode -lt 300 }).Count

    [pscustomobject]@{
        path = $Path
        requests = $RequestsPerEndpoint
        successfulResponses = $successCount
        avgMs = [math]::Round(($durations | Measure-Object -Average).Average, 2)
        minMs = [math]::Round(($durations | Measure-Object -Minimum).Minimum, 2)
        maxMs = [math]::Round(($durations | Measure-Object -Maximum).Maximum, 2)
    }
}

function Measure-RateLimitBurst {
    $path = "/views/best_offers?limit=1"
    $results = for ($i = 0; $i -lt $BurstRequests; $i++) {
        Invoke-TimedRequest -Path $path
    }

    [pscustomobject]@{
        path = $path
        requests = $BurstRequests
        successfulResponses = ($results | Where-Object { $_.StatusCode -ge 200 -and $_.StatusCode -lt 300 }).Count
        rateLimitedResponses = ($results | Where-Object { $_.StatusCode -eq 429 }).Count
        otherResponses = ($results | Where-Object { $_.StatusCode -ne 429 -and ($_.StatusCode -lt 200 -or $_.StatusCode -ge 300) }).Count
    }
}

Write-Info "Checking API health at $ApiUrl/health"
$healthProbe = Invoke-WebRequest -Uri "$ApiUrl/health" -Method Get -TimeoutSec 20 -UseBasicParsing
if ([int]$healthProbe.StatusCode -ne 200) {
    throw "API is not healthy at $ApiUrl"
}

$report = [ordered]@{
    apiUrl = $ApiUrl
    timestamp = (Get-Date).ToString("o")
    requestsPerEndpoint = $RequestsPerEndpoint
    burstRequests = $BurstRequests
    endpoints = @(
        (Measure-Endpoint -Path "/health"),
        (Measure-Endpoint -Path "/views/best_offers?limit=20"),
        (Measure-Endpoint -Path "/views/trusted_price_summary?limit=20")
    )
    rateLimitBurst = Measure-RateLimitBurst
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$resultsFile = "performance-results-$timestamp.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $resultsFile -Encoding UTF8

Write-Info "Saved results to $resultsFile"

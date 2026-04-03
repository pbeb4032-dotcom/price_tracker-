#!/usr/bin/env bash

set -euo pipefail

API_URL="${API_URL:-http://localhost:8787}"
REQUESTS_PER_ENDPOINT="${REQUESTS_PER_ENDPOINT:-20}"
BURST_REQUESTS="${BURST_REQUESTS:-80}"
RESULTS_FILE="performance-results-$(date +%Y%m%d_%H%M%S).json"

log() {
  printf '[performance-benchmarks] %s\n' "$1"
}

die() {
  printf '[performance-benchmarks] ERROR: %s\n' "$1" >&2
  exit 1
}

add_float() {
  awk -v a="$1" -v b="$2" 'BEGIN { printf "%.6f", a + b }'
}

measure_endpoint() {
  local endpoint="$1"
  local total_time="0"
  local min_time="999999"
  local max_time="0"
  local success_count=0
  local index

  for index in $(seq 1 "$REQUESTS_PER_ENDPOINT"); do
    local result
    local time_part
    local status_part

    result="$(curl -o /dev/null -sS -w "%{time_total} %{http_code}" "$API_URL$endpoint" || true)"
    time_part="${result%% *}"
    status_part="${result##* }"

    total_time="$(add_float "$total_time" "$time_part")"
    min_time="$(awk -v current="$min_time" -v candidate="$time_part" 'BEGIN { if (candidate < current) printf "%.6f", candidate; else printf "%.6f", current }')"
    max_time="$(awk -v current="$max_time" -v candidate="$time_part" 'BEGIN { if (candidate > current) printf "%.6f", candidate; else printf "%.6f", current }')"

    if [[ "$status_part" == 2* ]]; then
      success_count=$((success_count + 1))
    fi
  done

  local average_time
  average_time="$(awk -v total="$total_time" -v count="$REQUESTS_PER_ENDPOINT" 'BEGIN { if (count == 0) printf "%.6f", 0; else printf "%.6f", total / count }')"

  printf '{"path":"%s","requests":%s,"successfulResponses":%s,"avgSeconds":%s,"minSeconds":%s,"maxSeconds":%s}' \
    "$endpoint" \
    "$REQUESTS_PER_ENDPOINT" \
    "$success_count" \
    "$average_time" \
    "$min_time" \
    "$max_time"
}

measure_rate_limit_burst() {
  local path="/views/best_offers?limit=1"
  local success_count=0
  local rate_limited_count=0
  local other_count=0
  local index

  for index in $(seq 1 "$BURST_REQUESTS"); do
    local status_part
    status_part="$(curl -o /dev/null -sS -w "%{http_code}" "$API_URL$path" || true)"

    if [[ "$status_part" == "429" ]]; then
      rate_limited_count=$((rate_limited_count + 1))
    elif [[ "$status_part" == 2* ]]; then
      success_count=$((success_count + 1))
    else
      other_count=$((other_count + 1))
    fi
  done

  printf '{"path":"%s","requests":%s,"successfulResponses":%s,"rateLimitedResponses":%s,"otherResponses":%s}' \
    "$path" \
    "$BURST_REQUESTS" \
    "$success_count" \
    "$rate_limited_count" \
    "$other_count"
}

main() {
  command -v curl >/dev/null 2>&1 || die "curl is required."
  command -v awk >/dev/null 2>&1 || die "awk is required."

  curl -fsS "$API_URL/health" >/dev/null 2>&1 || die "API is not healthy at $API_URL"

  log "Benchmarking $API_URL"

  local health_results
  local best_offers_results
  local trusted_summary_results
  local rate_limit_results

  health_results="$(measure_endpoint "/health")"
  best_offers_results="$(measure_endpoint "/views/best_offers?limit=20")"
  trusted_summary_results="$(measure_endpoint "/views/trusted_price_summary?limit=20")"
  rate_limit_results="$(measure_rate_limit_burst)"

  cat > "$RESULTS_FILE" <<EOF
{
  "apiUrl": "$API_URL",
  "timestamp": "$(date -Iseconds)",
  "requestsPerEndpoint": $REQUESTS_PER_ENDPOINT,
  "burstRequests": $BURST_REQUESTS,
  "endpoints": [
    $health_results,
    $best_offers_results,
    $trusted_summary_results
  ],
  "rateLimitBurst": $rate_limit_results
}
EOF

  log "Saved results to $RESULTS_FILE"
}

main "$@"

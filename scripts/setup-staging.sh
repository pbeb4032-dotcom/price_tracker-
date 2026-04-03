#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.staging"
EXAMPLE_FILE=".env.staging.example"
COMPOSE_FILE="docker-compose.staging.yml"
API_HEALTH_URL="${API_HEALTH_URL:-http://localhost:8787/health}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://localhost:5173/}"
PROMETHEUS_HEALTH_URL="${PROMETHEUS_HEALTH_URL:-http://localhost:9090/-/ready}"
GRAFANA_HEALTH_URL="${GRAFANA_HEALTH_URL:-http://localhost:3000/api/health}"

log() {
  printf '[setup-staging] %s\n' "$1"
}

warn() {
  printf '[setup-staging] WARN: %s\n' "$1"
}

die() {
  printf '[setup-staging] ERROR: %s\n' "$1" >&2
  exit 1
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    die "Docker Compose is not available."
  fi
}

load_env() {
  set -a
  . "$ENV_FILE"
  set +a
}

require_var() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "Required environment variable is missing: $name"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local attempts="${3:-24}"
  local attempt

  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$label is ready at $url"
      return 0
    fi
    sleep 5
  done

  die "$label did not become ready: $url"
}

main() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed."
  docker info >/dev/null 2>&1 || die "Docker is not running."
  command -v curl >/dev/null 2>&1 || die "curl is required."
  [[ -f "$EXAMPLE_FILE" ]] || die "Missing $EXAMPLE_FILE."
  [[ -f "$COMPOSE_FILE" ]] || die "Missing $COMPOSE_FILE."

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    warn "Created $ENV_FILE from $EXAMPLE_FILE."
    warn "Set DB_PASSWORD, APP_JWT_SECRET, and INTERNAL_JOB_SECRET, then rerun this script."
    exit 0
  fi

  load_env

  require_var DB_PASSWORD
  require_var APP_JWT_SECRET
  require_var INTERNAL_JOB_SECRET

  log "Validating Compose configuration"
  compose config >/dev/null

  log "Starting staging stack"
  compose up -d --build

  wait_for_url "API" "$API_HEALTH_URL"
  wait_for_url "Web" "$WEB_HEALTH_URL"
  wait_for_url "Prometheus" "$PROMETHEUS_HEALTH_URL"
  wait_for_url "Grafana" "$GRAFANA_HEALTH_URL"

  log "Checking database readiness"
  compose exec -T db pg_isready -U postgres -d price_tracker_iraq_staging >/dev/null

  log "Staging environment is ready"
  log "Web: $WEB_HEALTH_URL"
  log "API: $API_HEALTH_URL"
}

main "$@"

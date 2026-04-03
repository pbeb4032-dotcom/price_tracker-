#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.production.yml"
API_HEALTH_URL="${API_HEALTH_URL:-http://localhost:58787/health}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://localhost:8080/}"
PROMETHEUS_HEALTH_URL="${PROMETHEUS_HEALTH_URL:-http://localhost:9090/-/ready}"
GRAFANA_HEALTH_URL="${GRAFANA_HEALTH_URL:-http://localhost:3000/api/health}"

log() {
  printf '[deploy-production] %s\n' "$1"
}

die() {
  printf '[deploy-production] ERROR: %s\n' "$1" >&2
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
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE. Run ./scripts/setup-production.sh first."
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
  local attempts="${3:-30}"
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

  [[ -f "$COMPOSE_FILE" ]] || die "Missing $COMPOSE_FILE."

  load_env

  require_var DB_PASSWORD
  require_var DATABASE_URL
  require_var REDIS_URL
  require_var APP_JWT_SECRET
  require_var INTERNAL_JOB_SECRET
  require_var VITE_API_BASE_URL
  require_var GRAFANA_ADMIN_PASSWORD

  log "Validating Compose configuration"
  compose config >/dev/null

  log "Starting production stack"
  compose up -d --build

  wait_for_url "API" "$API_HEALTH_URL"
  wait_for_url "Web" "$WEB_HEALTH_URL"
  wait_for_url "Prometheus" "$PROMETHEUS_HEALTH_URL"
  wait_for_url "Grafana" "$GRAFANA_HEALTH_URL"

  log "Current service status"
  compose ps

  log "Deployment complete"
  log "Direct API health: $API_HEALTH_URL"
  log "Public web entrypoint: $WEB_HEALTH_URL"
}

main "$@"

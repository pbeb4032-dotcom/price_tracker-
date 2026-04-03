#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE=".env.production"
EXAMPLE_FILE=".env.production.example"

log() {
  printf '[setup-production] %s\n' "$1"
}

warn() {
  printf '[setup-production] WARN: %s\n' "$1"
}

die() {
  printf '[setup-production] ERROR: %s\n' "$1" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || die "Missing required file: $1"
}

have_compose() {
  docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1
}

main() {
  command -v docker >/dev/null 2>&1 || die "Docker is not installed."
  docker info >/dev/null 2>&1 || die "Docker is not running."
  have_compose || die "Docker Compose is not available."

  require_file "$EXAMPLE_FILE"
  require_file "docker-compose.production.yml"
  require_file "Dockerfile.web"
  require_file "nginx/nginx.conf"
  require_file "monitoring/prometheus.yml"

  mkdir -p nginx/ssl

  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$EXAMPLE_FILE" "$ENV_FILE"
    warn "Created $ENV_FILE from $EXAMPLE_FILE."
  else
    log "$ENV_FILE already exists. Leaving it unchanged."
  fi

  log "Review $ENV_FILE and set at minimum:"
  log "  DB_PASSWORD"
  log "  DATABASE_URL"
  log "  REDIS_URL"
  log "  APP_JWT_SECRET"
  log "  INTERNAL_JOB_SECRET"
  log "  VITE_API_BASE_URL"
  log "  GRAFANA_ADMIN_PASSWORD"
  log "Optional production features require SMTP_* and VAPID_* values."
  log "When ready, deploy with ./scripts/deploy-production.sh"
}

main "$@"

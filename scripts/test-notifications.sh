#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ENV_FILE:-.env.staging}"
API_URL="${API_URL:-http://localhost:8787}"
WEB_URL="${WEB_URL:-http://localhost:5173}"

log() {
  printf '[notifications-check] %s\n' "$1"
}

warn() {
  printf '[notifications-check] WARN: %s\n' "$1"
}

die() {
  printf '[notifications-check] ERROR: %s\n' "$1" >&2
  exit 1
}

check_var_group() {
  local label="$1"
  shift
  local missing=0
  local name

  for name in "$@"; do
    if [[ -n "${!name:-}" ]]; then
      log "$label variable present: $name"
    else
      warn "$label variable missing: $name"
      missing=1
    fi
  done

  return "$missing"
}

main() {
  command -v curl >/dev/null 2>&1 || die "curl is required."

  if [[ -f "$ENV_FILE" ]]; then
    set -a
    . "$ENV_FILE"
    set +a
    log "Loaded environment from $ENV_FILE"
  else
    warn "Environment file not found: $ENV_FILE"
  fi

  curl -fsS "$API_URL/health" >/dev/null 2>&1 || die "API is not healthy at $API_URL"

  local smtp_ready=0
  local push_ready=0

  if check_var_group "SMTP" SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_FROM; then
    smtp_ready=1
  fi

  if check_var_group "Push" VAPID_EMAIL VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; then
    push_ready=1
  fi

  log "Manual notification smoke test checklist:"
  log "  1. Open the web app at $WEB_URL"
  log "  2. Sign in and create or update a price alert"
  log "  3. If testing push, grant browser notification permission"
  log "  4. Trigger the relevant scheduler or alert condition"
  log "  5. Watch API logs in your active compose stack while the alert is processed"

  if [[ "$smtp_ready" -eq 1 ]]; then
    log "SMTP configuration is present."
  else
    warn "Email delivery is not fully configured."
  fi

  if [[ "$push_ready" -eq 1 ]]; then
    log "Push notification configuration is present."
  else
    warn "Push notification delivery is not fully configured."
  fi
}

main "$@"

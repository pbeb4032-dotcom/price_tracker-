#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env" ]; then
  echo "[!] .env not found. Copying .env.example -> .env"
  cp .env.example .env
  echo "[!] Edit .env if you want to change DB/API settings"
fi

echo "[1/4] Starting Postgres (Docker)..."
docker compose -f docker-compose.full.yml up -d db searxng

echo "[2/4] Waiting for DB to be ready..."
for i in {1..40}; do
  if docker compose exec -T db pg_isready -U postgres -d price_tracker_iraq >/dev/null 2>&1; then
    echo "[db] ready"
    break
  fi
  sleep 1
done

echo "[3/5] Installing web dependencies..."
npm install

echo "[4/5] Installing API dependencies..."
npm --prefix api install

echo "[5/5] Starting API + Web..."
npm run dev:all

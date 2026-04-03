#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[1/2] Starting FULL STACK (db+api+web+searxng) with Docker..."
docker compose -f docker-compose.full.yml up -d --build

echo "[2/2] Done."
echo "Web:   http://localhost:8080"
echo "API:   http://localhost:8787/health"
echo "Searx: http://localhost:8081"

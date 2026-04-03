#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
node scripts/run-final-release-gate.mjs
OUT_DIR="$ROOT_DIR/artifacts"
mkdir -p "$OUT_DIR"
OUT_ZIP="$OUT_DIR/price-tracker-iraq-final-release.zip"
rm -f "$OUT_ZIP"
zip -qr "$OUT_ZIP" . \
  -x "node_modules/*" \
  -x "api/node_modules/*" \
  -x ".git/*" \
  -x "artifacts/*" \
  -x "dist/*" \
  -x "api/dist/*" \
  -x ".env" \
  -x ".env.*" \
  -x "api/.env" \
  -x "*.log" \
  -x "tmp/*"
printf 'created %s
' "$OUT_ZIP"

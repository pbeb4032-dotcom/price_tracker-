#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8787}"
SECRET="${JOB_SECRET:-job-secret}"
H=( -H "Content-Type: application/json" -H "x-job-secret: ${SECRET}" )

curl -fsS -X POST "${BASE_URL}/admin/jobs/patch_admin_health_schema" "${H[@]}" -d '{}'
curl -fsS -X POST "${BASE_URL}/admin/jobs/patch_taxonomy_v2_schema" "${H[@]}" -d '{}'
curl -fsS -X POST "${BASE_URL}/admin/jobs/patch_category_conflict_schema" "${H[@]}" -d '{}'
curl -fsS -X POST "${BASE_URL}/admin/jobs/seed_taxonomy_v2" "${H[@]}" -d '{}'
curl -fsS -X POST "${BASE_URL}/admin/jobs/backfill_taxonomy_v2" "${H[@]}" -d '{"limit":50000}'
curl -fsS -X POST "${BASE_URL}/admin/jobs/reclassify_categories_smart" "${H[@]}" -d '{"limit":50000,"force":false}'
echo
printf '
=== app_report ===
'
curl -fsS "${BASE_URL}/admin/app_report?hours=24" -H "x-job-secret: ${SECRET}"
printf '

=== category_conflicts ===
'
curl -fsS "${BASE_URL}/admin/category_conflicts?status=open&limit=25" -H "x-job-secret: ${SECRET}"

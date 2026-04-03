$base = if ($env:BASE_URL) { $env:BASE_URL } else { 'http://localhost:8787' }
$secret = if ($env:JOB_SECRET) { $env:JOB_SECRET } else { 'job-secret' }
$headers = @{ 'Content-Type'='application/json'; 'x-job-secret'=$secret }
irm -Method Post "$base/admin/jobs/patch_admin_health_schema" -Headers $headers -Body '{}'
irm -Method Post "$base/admin/jobs/patch_taxonomy_v2_schema" -Headers $headers -Body '{}'
irm -Method Post "$base/admin/jobs/patch_category_conflict_schema" -Headers $headers -Body '{}'
irm -Method Post "$base/admin/jobs/seed_taxonomy_v2" -Headers $headers -Body '{}'
irm -Method Post "$base/admin/jobs/backfill_taxonomy_v2" -Headers $headers -Body '{"limit":50000}'
irm -Method Post "$base/admin/jobs/reclassify_categories_smart" -Headers $headers -Body '{"limit":50000,"force":false}'
"`n=== app_report ==="
irm "$base/admin/app_report?hours=24" -Headers @{ 'x-job-secret'=$secret }
"`n=== category_conflicts ==="
irm "$base/admin/category_conflicts?status=open&limit=25" -Headers @{ 'x-job-secret'=$secret }

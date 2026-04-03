# Production Operations Manual

## Canonical Operating Model

The repository now treats one production shape as authoritative:

- API-first Docker Compose
- PostgreSQL as the primary persistence layer
- Redis available for cache and rate-limiting paths
- frontend compiled once and served through Nginx
- Prometheus plus Grafana provisioned from tracked files

The repo no longer treats Railway or AWS-specific deployment flows as first-class operational guidance.

## Service Inventory

Production Compose services:

- `postgres`
- `redis`
- `api`
- `web`
- `postgres-exporter`
- `redis-exporter`
- `prometheus`
- `grafana`
- `nginx`

Primary files that operators should know:

- `docker-compose.production.yml`
- `.env.production`
- `nginx/nginx.conf`
- `monitoring/prometheus.yml`
- `monitoring/grafana/`
- `scripts/setup-production.sh`
- `scripts/deploy-production.sh`

## Standard Release Procedure

1. Validate the repo state.

```bash
npm test
npm run build
npm --prefix api run typecheck
npm --prefix api test
```

2. Review any changes to:

- `.env.production.example`
- `docker-compose.production.yml`
- `nginx/nginx.conf`
- `monitoring/prometheus.yml`
- `monitoring/grafana/`

3. Update the production checkout to the target commit.

4. Deploy with:

```bash
./scripts/deploy-production.sh
```

5. Verify:

```bash
curl http://localhost:58787/health
curl http://localhost:8080/
curl http://localhost:9090/-/ready
curl http://localhost:3000/api/health
```

6. Watch logs and dashboards for at least one release window after deployment.

## Daily and Weekly Checks

Daily:

- `docker compose -f docker-compose.production.yml ps`
- check API health and Grafana health
- check dashboard panels for request rate, latency, errors, and crawler activity

Weekly:

- review container logs for repeated warnings
- confirm alerting paths still have valid SMTP and VAPID configuration if those features are in use
- review disk usage for PostgreSQL, Prometheus, and Grafana volumes

## Key Metrics

Important application metrics exported by the API:

- `http_requests_total`
- `http_request_duration_seconds`
- `db_queries_total`
- `db_query_duration_seconds`
- `cache_hits_total`
- `cache_misses_total`
- `products_tracked_total`
- `price_updates_total`
- `crawler_jobs_active`
- `crawler_jobs_completed_total`
- `alerts_sent_total`
- `errors_total`

Important infrastructure targets:

- `up{job="price-tracker-api"}`
- `up{job="postgres-exporter"}`
- `up{job="redis-exporter"}`
- `up{job="prometheus"}`

## Logs and Diagnostics

Useful commands:

```bash
docker compose -f docker-compose.production.yml logs -f api
docker compose -f docker-compose.production.yml logs -f nginx
docker compose -f docker-compose.production.yml logs -f postgres
docker compose -f docker-compose.production.yml logs -f redis
docker compose -f docker-compose.production.yml logs -f prometheus grafana
```

Focused checks:

```bash
curl http://localhost:58787/health
curl http://localhost:58787/metrics
docker compose -f docker-compose.production.yml exec postgres pg_isready -U price_tracker_prod -d price_tracker_prod
docker compose -f docker-compose.production.yml exec redis redis-cli ping
```

## Backups

Minimum recommended database backup command:

```bash
docker compose -f docker-compose.production.yml exec -T postgres \
  pg_dump -U price_tracker_prod price_tracker_prod > backup_$(date +%Y%m%d_%H%M%S).sql
```

Operational notes:

- keep backups outside the repo checkout
- treat `.env.production` as a secret and back it up separately in your secret-management workflow
- verify restores periodically on a staging or recovery host

## Incident Playbooks

### API down or unhealthy

1. Check `docker compose ... ps`
2. Inspect `api`, `postgres`, and `redis` logs
3. Confirm `.env.production` still has correct `DATABASE_URL`, `REDIS_URL`, and `APP_JWT_SECRET`
4. Restart the API only if the cause is understood

```bash
docker compose -f docker-compose.production.yml restart api
```

### Web is serving stale or broken content

1. Check the `web` and `nginx` containers
2. Rebuild `web` and `nginx` together if the frontend bundle changed

```bash
docker compose -f docker-compose.production.yml up -d --build web nginx
```

3. Reconfirm `VITE_API_BASE_URL` in `.env.production`

### Metrics missing

1. Check `http://localhost:58787/metrics`
2. Inspect Prometheus logs
3. Confirm exporter containers are healthy
4. Reopen Grafana after the datasource and dashboard provisioning settle

### Notifications not sending

1. Verify `SMTP_*` values in `.env.production`
2. Verify `VAPID_*` values if push notifications are expected
3. Inspect API logs for notification and SMTP errors
4. Reproduce in staging first if the issue is unclear

## Staging Parity

Before any risky operational change, reproduce it in the staging stack:

```bash
./scripts/setup-staging.sh
```

Staging defaults:

- web: `http://localhost:5173`
- API: `http://localhost:8787`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

If a procedure cannot be demonstrated safely in staging, document that risk before applying it in production.

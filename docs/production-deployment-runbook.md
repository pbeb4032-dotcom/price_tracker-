# Production Deployment Runbook

## Scope

This runbook covers the repository's canonical production path:

- standalone, API-first Docker Compose
- frontend built once with `Dockerfile.web` and served by Nginx
- PostgreSQL plus Redis in the same Compose stack
- Prometheus and Grafana running from the tracked monitoring config

This runbook intentionally does not describe Railway, ECS, or alternate deployment stories.

## Stack Layout

Tracked production assets:

- `docker-compose.production.yml`
- `Dockerfile.web`
- `nginx/nginx.conf`
- `monitoring/prometheus.yml`
- `monitoring/grafana/`
- `.env.production.example`
- `scripts/setup-production.sh`
- `scripts/deploy-production.sh`

Default local access points from the production Compose file:

- Nginx: `http://localhost:8080`
- API direct: `http://localhost:58787`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

The API is also available inside the stack as `http://api:8787`.

## Pre-Deployment Checklist

Before touching production, confirm all of the following:

- Docker Engine is installed and running
- `docker compose` or `docker-compose` is available on the host
- the repo checkout is at the release commit you intend to run
- `.env.production` exists and contains real secrets
- `nginx/ssl/` contains certificates if you plan to enable TLS in Nginx
- the host firewall allows the ports you intend to expose

Required environment values for the canonical stack:

- `DB_PASSWORD`
- `DATABASE_URL`
- `REDIS_URL`
- `APP_JWT_SECRET`
- `INTERNAL_JOB_SECRET`
- `VITE_API_BASE_URL`
- `GRAFANA_ADMIN_PASSWORD`

Optional but production-relevant:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `VAPID_EMAIL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `SENTRY_DSN`

## First-Time Host Setup

1. Clone the repo and move into it.

```bash
git clone https://github.com/pbeb4032-dotcom/price_tracker-.git
cd price-tracker-
```

2. Copy the production env template and edit it.

```bash
cp .env.production.example .env.production
```

3. Fill in real values in `.env.production`.

Important notes:

- `DATABASE_URL` should target the internal `postgres` service unless you intentionally use an external database.
- `VITE_API_BASE_URL` should point at the public `/api` path served by your reverse proxy, for example `https://price-tracker-iraq.com/api`.
- leave `DEV_LOGIN_SECRET` empty in production unless you have an explicit operational reason to enable it.

4. Prepare TLS material if you want HTTPS termination in the tracked Nginx container.

```bash
mkdir -p nginx/ssl
```

5. Validate the Compose file before the first deploy.

```bash
docker compose -f docker-compose.production.yml config
```

## Validation Before Release

Run the same checks that currently define a good repo state:

```bash
npm test
npm run build
npm --prefix api run typecheck
npm --prefix api test
```

If any of these fail, fix that before deploying.

## Deployment Flow

1. Bootstrap the tracked production assets.

```bash
./scripts/setup-production.sh
```

2. Deploy the stack.

```bash
./scripts/deploy-production.sh
```

What the scripts do:

- `setup-production.sh` verifies Docker and the tracked production files, creates `.env.production` from the example when missing, and prepares the local `nginx/ssl/` directory.
- `deploy-production.sh` loads `.env.production`, validates the critical variables, runs `docker compose -f docker-compose.production.yml up -d --build`, and waits for health endpoints.

## Post-Deploy Verification

Run all of the following after deployment:

```bash
curl http://localhost:58787/health
curl http://localhost:8080/
curl http://localhost:9090/-/ready
curl http://localhost:3000/api/health
docker compose -f docker-compose.production.yml ps
```

Expected outcomes:

- `/health` returns a healthy JSON payload
- the web root responds successfully through Nginx
- Prometheus reports ready
- Grafana reports healthy
- all Compose services show as running or healthy

## Day-Two Operations

Useful commands:

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f api
docker compose -f docker-compose.production.yml logs -f web
docker compose -f docker-compose.production.yml logs -f nginx
docker compose -f docker-compose.production.yml logs -f prometheus grafana
docker compose -f docker-compose.production.yml restart api web
docker compose -f docker-compose.production.yml up -d --build api web
```

## Rollback

The tracked production stack is source-build based, so rollback is commit-driven:

1. Check out the previous known-good commit or tag.
2. Restore the matching `.env.production` if it changed.
3. Redeploy with the same script.

```bash
git checkout <known-good-commit>
./scripts/deploy-production.sh
```

If the issue is config-only, restore the prior `.env.production` and rerun the deploy script without changing the code checkout.

## Troubleshooting

### API unhealthy

Check:

```bash
docker compose -f docker-compose.production.yml logs --tail=200 api
docker compose -f docker-compose.production.yml logs --tail=200 postgres
docker compose -f docker-compose.production.yml logs --tail=200 redis
```

Common causes:

- wrong `DATABASE_URL`
- missing `APP_JWT_SECRET`
- database container not healthy yet
- Redis URL mismatch

### Web root loads but API calls fail

Check:

- `VITE_API_BASE_URL` in `.env.production`
- Nginx proxy config in `nginx/nginx.conf`
- direct API health on `http://localhost:58787/health`

### Prometheus or Grafana is empty

Check:

```bash
curl http://localhost:58787/metrics
docker compose -f docker-compose.production.yml logs --tail=200 prometheus
docker compose -f docker-compose.production.yml logs --tail=200 grafana
```

Also verify the exporters are up:

```bash
docker compose -f docker-compose.production.yml ps postgres-exporter redis-exporter
```

## Notes

- The tracked production Compose file uses `8080` for Nginx and `58787` for the direct API port to avoid host conflicts on mixed-use machines.
- The repo's canonical public story is still "frontend behind Nginx, API behind `/api`". The direct API port is primarily for health checks and local operational access.
- Keep operational drafts and one-off root notes out of the repo. Long-lived documentation belongs under `docs/`, and executable operational tooling belongs under `scripts/`.

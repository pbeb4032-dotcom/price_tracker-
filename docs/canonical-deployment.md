# Canonical Deployment Story

The canonical deployment path for this repository is now **standalone, API-first Docker Compose**.

## What that means

- The **API** is the source of truth for application behavior, authentication, database access, metrics, and health checks.
- The **web app** is built once with Vite and served as static files through Nginx. It is not expected to run `vite dev` in staging or production.
- **PostgreSQL** is required for the canonical stack.
- **Redis** is optional for local development but recommended in staging and production because cache and rate-limiting paths can use it.
- **Prometheus** scrapes the API metrics endpoint plus dedicated PostgreSQL and Redis exporters.

## Primary files for this path

- `docker-compose.production.yml`
- `docker-compose.staging.yml`
- `Dockerfile.web`
- `nginx/nginx.conf`
- `monitoring/prometheus.yml`
- `.env.production.example`
- `.env.staging.example`

## Supabase status

Supabase-related files and compatibility code are kept for legacy or migration scenarios, but they are **not** the primary runtime story for this repo anymore.

If we deploy this project as intended, we should start from the API-first Compose stack and treat Supabase integrations as optional compatibility layers instead of the default path.

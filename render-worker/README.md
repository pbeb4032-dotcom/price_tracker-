# Render Worker (Playwright)

This service renders **JS-only** pages (React/Next/Nuxt heavy) and stores the HTML in Postgres (`rendered_pages`) with a TTL.
The API ingestion job (`ingestProductPages`) will then use the cached HTML instead of trying to scrape the empty shell.

## Env
- DATABASE_URL (required)
- RENDER_GLOBAL_CONCURRENCY (default 2)
- RENDER_WORKER_POLL_MS (default 1000)
- RENDER_CACHE_TTL_MIN (default 720)
- RENDER_BUDGET_PER_HOUR_DEFAULT (default 80)

## Run (Docker Compose)
`docker compose -f docker-compose.full.yml up -d --build render_worker`

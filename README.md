# Price Tracker Iraq

API-first price intelligence platform for the Iraqi market.

The current repo combines:
- product and offer ingestion from real sources
- community price reporting
- search, compare, alerts, notifications, and history
- admin and operations tooling

## Quick Start

Requirements:
- Docker Desktop
- Node.js 18+

Windows:

```powershell
./scripts/run-dev.ps1
```

macOS / Linux:

```bash
bash scripts/run-dev.sh
```

After startup:
- Web: `http://localhost:5173`
- API: `http://localhost:8787`

Admin login:
- Email: `admin@local`
- Password: `admin123`

## First Run

1. Open `/admin`
2. Install the large Iraq source pack
3. Run the full pipeline: seed, APIs, ingest, and images

## Repository Layout

- `src/`: React frontend
- `api/`: Hono API and jobs
- `db/`: database bootstrap and seed scripts
- `public/source-packs/`: source-pack JSON
- `docs/`: architecture and runbooks

## Production

The canonical deployment story is documented in [docs/canonical-deployment.md](docs/canonical-deployment.md).

Tracked production references:
- [docs/canonical-deployment.md](docs/canonical-deployment.md)
- [PROJECT_FULL_AUDIT.md](PROJECT_FULL_AUDIT.md)
- [.env.production.example](.env.production.example)
- [docker-compose.production.yml](docker-compose.production.yml)
- [monitoring/prometheus.yml](monitoring/prometheus.yml)

Notes:
- The repo is API-first, not Supabase-first.
- The frontend should be built once and served statically in staging and production.
- Redis is optional locally and recommended in staging and production.

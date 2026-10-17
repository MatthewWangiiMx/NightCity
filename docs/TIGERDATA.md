# TigerData (TimescaleDB) setup

The app runs fine without a database (`USE_DATABASE=false`). Turn it on when you want runs
and telemetry persisted.

## 1. Credentials

From the TigerData console, open your service → **Connect** → copy the connection string.
Put it in `backend/.env` (never commit it):

```
TIGERDATA_URL=postgresql://tsdbadmin:<password>@<host>.tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require
USE_DATABASE=true
```

`sslmode=require` is mandatory. `app/db/session.py` rewrites the scheme to
`postgresql+psycopg://` for SQLAlchemy.

## 2. Schema

```powershell
psql "$env:TIGERDATA_URL" -f backend/app/db/migrations/001_init.sql
```

Tables: `districts`, `assets`, `runs`, `dispatch_actions`, and `telemetry` — a hypertable on
`t`, which is the reason for using Timescale at all: one row per asset per 15-minute step per
variant (`baseline` / `optimized`) adds up quickly across reruns.

Weather ingestion uses the separate migration `app/db/migrations/002_weather.sql`, which creates
the `weather_observations` hypertable. Apply it after the initial migration:

```powershell
psql "$env:TIGERDATA_URL" -f backend/app/db/migrations/002_weather.sql

## Buildings (Explore City)

Import downtown Toronto 3D Massing into the `buildings` table, then set
`USE_DATABASE=true` so `/api/buildings/massing` can serve live geometry:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python scripts/buildings/import_builds.py `
  ..\tmp\massing\extracted\3DMassingShapefile_2025_WGS84.shp `
  --bbox -79.41,43.63,-79.36,43.66
```

The Explore City viewer prefers TigerData; if the API is empty it falls back to
`frontend/public/data/toronto-massing.json`.
```

With `USE_DATABASE=true`, fetch and store three days of hourly weather for the default Toronto
coordinates:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/api/weather/ingest `
  -ContentType "application/json" -Body '{}'
```

You can provide any Open-Meteo-supported coordinate, plus up to 16 forecast days and 92 past
days:

```powershell
Invoke-RestMethod -Method Post http://localhost:8000/api/weather/ingest `
  -ContentType "application/json" `
  -Body '{"latitude":43.6532,"longitude":-79.3832,"forecast_days":7,"past_days":1}'
```

## 3. Code

`app/db/repository.py` holds the read/write functions (`save_run`, `load_run`,
`recent_telemetry`). Each one returns early when the session is `None`, so a database outage
degrades to an in-memory demo instead of breaking it.

Useful follow-ups once data lands: a continuous aggregate for per-hour averages, and a
retention policy on `telemetry` so repeated demo runs do not accumulate.

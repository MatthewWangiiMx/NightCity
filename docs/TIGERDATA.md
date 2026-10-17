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

## 3. Code

`app/db/repository.py` holds the read/write functions (`save_run`, `load_run`,
`recent_telemetry`). Each one returns early when the session is `None`, so a database outage
degrades to an in-memory demo instead of breaking it.

Useful follow-ups once data lands: a continuous aggregate for per-hour averages, and a
retention policy on `telemetry` so repeated demo runs do not accumulate.

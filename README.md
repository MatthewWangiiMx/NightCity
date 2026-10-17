# NightCity

GridShift × WattWise — a **simulated** energy grid digital twin. Trigger a disruption
(solar drop, heat wave, EV surge, battery outage, storm) and watch a transparent optimizer
coordinate buildings, batteries, EV charging and renewables, with the trade-offs shown live.

All figures are produced by a deterministic simulator from synthetic inputs. Nothing here is
measured data.

## Layout

```
backend/            FastAPI + deterministic simulator + heuristic optimizer
  app/api/routes/   HTTP surface (health, district, scenarios, simulation, dispatch, buildings)
  app/schemas/      Pydantic contracts, mirrored in frontend/src/api/types.ts
  app/sim/          simulator.py, optimizer.py, scenarios.py, district.py
  app/db/           TigerData session, repository, migrations/001_init.sql
  app/llm/          optional Claude explanation layer (never authoritative)
frontend/           React + TypeScript + Vite + Tailwind
  src/pages/        Home, Explore, Simulate, Plan, Building Detail
  src/components/   map/ (isometric district + timeline), charts/ (Recharts), panels/
  src/demo/         hardcoded run data, standing in for the simulator
  src/hooks/        useRun (API with demo fallback), usePlayback
docs/               METRICS.md (equations), TIGERDATA.md (database setup)
```

The front end is complete against **hardcoded demo data** in `src/demo/fixtures.ts`. The backend
simulator and optimizer still raise `NotImplementedError`, so `/api/simulation/run` returns 501 and
`useRun` falls back to the fixtures. When the simulator lands, the UI switches to live output with
no component changes.

## Run it

Backend (Python 3.12+):

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env     # fill in TIGERDATA_URL when ready
uvicorn app.main:app --reload --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173, /api proxied to :8000
```

`GET /api/health` reports whether the database and LLM layer are wired up. Both are optional —
the app runs with `USE_DATABASE=false` and `ENABLE_LLM=false`.

## Next steps

1. `app/sim/simulator.py` — demand curve, solar/wind profiles, battery state machine, thermal model.
2. `app/sim/optimizer.py` — heuristic plan with comfort as a hard constraint.
3. Charts in `frontend/src/components/charts/` (Recharts) and flow animation in `DistrictMap`.
4. TigerData: apply `backend/app/db/migrations/001_init.sql`, then fill in `app/db/repository.py`.
